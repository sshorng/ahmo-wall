import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { db } from '../firebase';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    where,
    Timestamp,
    getDoc,
    runTransaction,
    type Unsubscribe
} from 'firebase/firestore';
import { useAuthStore } from './auth';
import { DB_PREFIX } from '../composables/useAppConfig';

// Types
export interface Comment {
    id: string;
    author: {
        uid: string;
        displayName: string;
        photoURL: string;
    };
    content: string;
    createdAt: Date;
    status: 'approved' | 'pending';
}

export interface Board {
    id: string;
    title: string;
    description: string;
    layout: 'shelf' | 'wall' | 'grid' | 'stream';
    backgroundImage?: string;
    backgroundColor?: string;
    ownerId: string;
    privacy: 'public' | 'private' | 'password'; // Changed secret to private for consistency, user asked for private
    password?: string; // For password mode
    guestPermission?: 'edit' | 'view'; // For public/password mode
    moderationEnabled?: boolean;
    folderId?: string | null;
    defaultSort?: string; // New: Default sort for the board
    createdAt: Date;
}

export interface Folder {
    id: string;
    title: string;
    ownerId: string;
    createdAt: Date;
}

export interface Section {
    id: string;
    boardId: string;
    title: string;
    color: string;
    order: number;
}

// Cloudinary Attachment Structure
export interface Attachment {
    type: 'image' | 'video' | 'pdf' | 'link' | 'youtube' | 'audio';
    url?: string; // Cloudinary URL
    publicId?: string; // Cloudinary Public ID
    resourceType?: string; // Cloudinary Resource Type (e.g., 'image', 'video', 'raw')
    deleteToken?: string; // Short-term delete token (valid for 10 mins)
    thumbnailUrl?: string; // For video/pdf previews
    format?: string;

    // Legacy / External
    shareUrl?: string; // For YouTube or external links
    name?: string;

    // Deprecated (Google Drive)
    driveFileId?: string;
}

export interface PollOption {
    id: string;
    text: string;
    voters: string[]; // Array of UIDs
}

export interface Poll {
    question: string; // Creates a question title if needed, otherwise rely on Post title
    options: PollOption[];
    allowMultiple: boolean;
    totalVotes: number;
}

export interface Post {
    id: string;
    boardId: string;
    sectionId?: string; // For Shelf layout
    position?: { x: number; y: number }; // For Wall/Freeform layout
    author: {
        uid: string;
        displayName: string;
        photoURL: string;
    };
    content: string;
    title?: string; // New: Post title
    attachments: Attachment[];
    poll?: Poll; // New: Poll data
    comments?: Comment[];
    color?: string;
    likes: number;
    order: number; // For manual sorting
    status: 'approved' | 'pending';
    createdAt: Date;
}

export const useBoardStore = defineStore('board', () => {
    const authStore = useAuthStore();

    // State
    const boards = ref<Board[]>([]);
    const folders = ref<Folder[]>([]); // New
    const currentBoard = ref<Board | null>(null);
    const sections = ref<Section[]>([]);
    const posts = ref<Post[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // Unsubscribe functions for real-time listeners
    let unsubscribeBoards: Unsubscribe | null = null;
    let unsubscribeFolders: Unsubscribe | null = null; // New
    let unsubscribeSections: Unsubscribe | null = null;
    let unsubscribePosts: Unsubscribe | null = null;

    // Computed
    const sortedSections = computed(() =>
        [...sections.value].sort((a, b) => a.order - b.order)
    );

    const postsBySection = computed(() => {
        const map: Record<string, Post[]> = {};

        // 初始化區段映射
        sections.value.forEach(sec => {
            map[sec.id] = [];
        });

        // 遍歷貼文一次進行分組 (O(N))
        posts.value.forEach(post => {
            if (post.sectionId && map[post.sectionId]) {
                map[post.sectionId].push(post);
            }
        });

        // 僅對各區段內的貼文進行排序
        Object.keys(map).forEach(sectionId => {
            map[sectionId].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        });

        return map;
    });

    // Actions

    const toDate = (val: any): Date => {
        if (!val) return new Date();
        if (val instanceof Date) return val;
        if (val.toDate && typeof val.toDate === 'function') return val.toDate();
        if (val.seconds !== undefined) return new Date(val.seconds * 1000);
        if (typeof val === 'string' || typeof val === 'number') return new Date(val);
        return new Date();
    };

    /**
     * Subscribe to user's boards
     */
    const subscribeToBoards = () => {
        if (!authStore.user) return;

        // Remove orderBy to avoid needing a composite index in Firestore
        // We will sort in memory instead
        const q = query(
            collection(db, `${DB_PREFIX}boards`),
            where('ownerId', '==', authStore.user.uid)
        );

        unsubscribeBoards = onSnapshot(q, (snapshot) => {
            const fetchedBoards = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: toDate(doc.data().createdAt)
            })) as Board[];

            // Sort in memory
            boards.value = fetchedBoards.sort((a, b) =>
                b.createdAt.getTime() - a.createdAt.getTime()
            );
        });

        // Subscribe to folders
        const folderQ = query(
            collection(db, `${DB_PREFIX}folders`),
            where('ownerId', '==', authStore.user.uid)
        );

        if (unsubscribeFolders) unsubscribeFolders();

        unsubscribeFolders = onSnapshot(folderQ, (snapshot) => {
            folders.value = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: toDate(doc.data().createdAt)
            })) as Folder[];
        });
    };

    /**
     * Subscribe to a specific board's sections and posts
     */
    const subscribeToBoard = (boardId: string) => {
        // Unsubscribe from previous board
        if (unsubscribeSections) unsubscribeSections();
        if (unsubscribePosts) unsubscribePosts();

        // Subscribe to sections (Sort in client to avoid index issues)
        const sectionsQuery = query(
            collection(db, `${DB_PREFIX}boards`, boardId, 'sections')
        );

        unsubscribeSections = onSnapshot(sectionsQuery, (snapshot) => {
            const fetchedSections = snapshot.docs.map(doc => ({
                id: doc.id,
                boardId,
                ...doc.data()
            })) as Section[];

            sections.value = fetchedSections.sort((a, b) => {
                const orderA = a.order ?? 0;
                const orderB = b.order ?? 0;
                return orderA - orderB;
            });
        });

        // Subscribe to posts (Sort in client to avoid index issues)
        const postsQuery = query(
            collection(db, `${DB_PREFIX}boards`, boardId, 'posts')
        );

        unsubscribePosts = onSnapshot(postsQuery, (snapshot) => {
            const fetchedPosts = snapshot.docs.map(doc => ({
                id: doc.id,
                boardId,
                ...doc.data(),
                createdAt: toDate(doc.data().createdAt)
            })) as Post[];

            posts.value = fetchedPosts.sort((a, b) => {
                const orderA = a.order ?? 0;
                const orderB = b.order ?? 0;
                if (orderA !== orderB) return orderA - orderB;
                return b.createdAt.getTime() - a.createdAt.getTime();
            });
        });
    };

    /**
     * Create a new board
     */
    const createBoard = async (data: Partial<Board>): Promise<string> => {
        if (!authStore.user) throw new Error('Not authenticated');

        const boardData = {
            title: data.title || '未命名看板',
            description: data.description || '',
            layout: data.layout || 'shelf',
            backgroundImage: data.backgroundImage || '',
            backgroundColor: data.backgroundColor || '#1a1a2e',
            ownerId: authStore.user.uid,
            privacy: data.privacy || 'public',
            password: data.password || '',
            guestPermission: data.guestPermission || 'edit',
            moderationEnabled: data.moderationEnabled || false,
            defaultSort: data.defaultSort || 'manual',
            createdAt: Timestamp.now()
        };

        const docRef = await addDoc(collection(db, `${DB_PREFIX}boards`), boardData);

        // Create default sections for Shelf and Stream layouts
        // User requested single 'Uncategorized' section
        if (boardData.layout === 'shelf' || boardData.layout === 'stream') {
            await addDoc(collection(db, `${DB_PREFIX}boards`, docRef.id, 'sections'), {
                title: '未分類',
                color: '#16a34a',
                order: 0
            });
        }

        return docRef.id;
    };

    /**
     * Update board settings
     */
    const updateBoard = async (boardId: string, data: Partial<Board>) => {
        // Clean data
        const updateData = { ...data };
        delete updateData.id;
        delete updateData.createdAt;
        delete updateData.ownerId; // Owner cannot be changed easily

        await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId), updateData);
    };

    /**
     * Delete a board
     */
    const deleteBoard = async (boardId: string) => {
        await deleteDoc(doc(db, `${DB_PREFIX}boards`, boardId));
    };

    /**
     * Check board password
     */
    const checkBoardPassword = async (boardId: string, password: string): Promise<boolean> => {
        const boardRef = doc(db, `${DB_PREFIX}boards`, boardId);
        const boardSnap = await getDoc(boardRef);
        if (boardSnap.exists()) {
            const boardData = boardSnap.data() as Board;
            return boardData.password === password;
        }
        return false;
    };


    /**
     * Create a new section (for Shelf layout)
     */
    const createSection = async (boardId: string, title: string, color: string = '#6b7280') => {
        const order = sections.value.length;
        await addDoc(collection(db, `${DB_PREFIX}boards`, boardId, 'sections'), {
            title,
            color,
            order
        });
    };

    /**
     * Delete a section
     */
    const deleteSection = async (boardId: string, sectionId: string) => {
        // Find posts in this section first
        const postsToDelete = posts.value.filter(p => p.sectionId === sectionId);

        // Delete all posts
        const batch = postsToDelete.map(p =>
            deleteDoc(doc(db, `${DB_PREFIX}boards`, boardId, 'posts', p.id))
        );
        await Promise.all(batch);

        // Delete the section
        await deleteDoc(doc(db, `${DB_PREFIX}boards`, boardId, 'sections', sectionId));
    };

    /**
     * Helper to clean data for Firestore (remove undefined)
     */
    const cleanData = (data: any): any => {
        if (data === null || typeof data !== 'object') return data;
        if (data instanceof Timestamp || data instanceof Date) return data;

        if (Array.isArray(data)) {
            return data.map(item => cleanData(item));
        }

        const result: any = {};
        Object.keys(data).forEach(key => {
            if (data[key] !== undefined) {
                result[key] = cleanData(data[key]);
            }
        });
        return result;
    };

    const createPost = async (boardId: string, data: Partial<Post>, guestName?: string) => {
        // Allow anonymous posts (Firestore rules will handle security based on privacy)
        const author = authStore.user ? {
            uid: authStore.user.uid,
            displayName: authStore.user.displayName || '匿名',
            photoURL: authStore.user.photoURL || ''
        } : {
            uid: 'anonymous',
            displayName: guestName || '訪客',
            photoURL: ''
        };

        const isOwner = authStore.user && currentBoard.value?.ownerId === authStore.user.uid;

        console.log('[BoardStore] creating post checks:', {
            moderationEnabled: currentBoard.value?.moderationEnabled,
            isOwner,
            currentUser: authStore.user?.uid,
            boardOwner: currentBoard.value?.ownerId
        });

        const status = (currentBoard.value?.moderationEnabled && !isOwner) ? 'pending' : 'approved';
        console.log('[BoardStore] post status determined:', status);

        const postData = {
            sectionId: data.sectionId || null,
            position: data.position || null,
            author,
            title: data.title || '',
            content: data.content || '',
            attachments: data.attachments || [],
            poll: data.poll || null, // FIX: Pass through poll data
            color: data.color || '#ffffff',
            likes: 0,
            status,
            createdAt: Timestamp.now()
        };

        const sectionPosts = posts.value.filter(p => p.sectionId === postData.sectionId);
        const order = sectionPosts.length;

        await addDoc(collection(db, `${DB_PREFIX}boards`, boardId, 'posts'), cleanData({
            ...postData,
            order
        }));
    };

    /**
     * Update a post
     */
    const updatePost = async (boardId: string, postId: string, data: Partial<Post>) => {
        await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId, 'posts', postId), cleanData(data));
    };

    /**
     * Delete a post
     */
    const deletePost = async (boardId: string, postId: string) => {
        await deleteDoc(doc(db, `${DB_PREFIX}boards`, boardId, 'posts', postId));
    };

    /**
     * Approve a post
     */
    const approvePost = async (boardId: string, postId: string) => {
        await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId, 'posts', postId), { status: 'approved' });
    };

    /**
     * Approve all pending posts and comments
     */
    const approveAll = async (boardId: string) => {
        // Approve all posts
        const pendingPosts = posts.value.filter(p => p.status === 'pending');
        const postPromises = pendingPosts.map(p =>
            updateDoc(doc(db, `${DB_PREFIX}boards`, boardId, 'posts', p.id), { status: 'approved' })
        );

        // Approve all comments in all posts (including those already approved)
        const postWithPendingComments = posts.value.filter(p => p.comments?.some(c => c.status === 'pending'));
        const commentPromises = postWithPendingComments.map(async (p) => {
            const newComments = p.comments?.map(c => ({ ...c, status: 'approved' }));
            return updateDoc(doc(db, `${DB_PREFIX}boards`, boardId, 'posts', p.id), { comments: newComments });
        });

        await Promise.all([...postPromises, ...commentPromises]);
    };


    /**
     * Add a comment to a post
     */
    const addComment = async (boardId: string, postId: string, content: string, guestName?: string) => {
        // Allow anonymous comments
        const author = authStore.user ? {
            uid: authStore.user.uid,
            displayName: authStore.user.displayName || '匿名',
            photoURL: authStore.user.photoURL || ''
        } : {
            uid: 'anonymous',
            displayName: guestName || '訪客',
            photoURL: ''
        };

        const isOwner = authStore.user && currentBoard.value?.ownerId === authStore.user.uid;

        console.log('[BoardStore] creating post/comment checks:', {
            moderationEnabled: currentBoard.value?.moderationEnabled,
            isOwner,
            currentUser: authStore.user?.uid,
            boardOwner: currentBoard.value?.ownerId
        });

        const status = (currentBoard.value?.moderationEnabled && !isOwner) ? 'pending' : 'approved';
        console.log('[BoardStore] status determined:', status);

        const comment: Comment = {
            id: Date.now().toString(), // Simple ID generation
            author,
            content,
            status,
            createdAt: new Date()
        };

        const postRef = doc(db, `${DB_PREFIX}boards`, boardId, 'posts', postId);

        // Let's use getDoc to get current comments array first to be safe
        const postDoc = await getDoc(postRef);
        if (postDoc.exists()) {
            const currentComments = postDoc.data().comments || [];
            await updateDoc(postRef, {
                comments: [...currentComments, comment]
            });
        }
    };

    /**
     * Approve a comment
     */
    const approveComment = async (boardId: string, postId: string, commentId: string) => {
        const postRef = doc(db, `${DB_PREFIX}boards`, boardId, 'posts', postId);
        const postDoc = await getDoc(postRef);
        if (postDoc.exists()) {
            const currentComments = postDoc.data().comments || [];
            const newComments = currentComments.map((c: Comment) =>
                c.id === commentId ? { ...c, status: 'approved' } : c
            );
            await updateDoc(postRef, { comments: newComments });
        }
    };


    /**
     * Delete a comment
     */
    const deleteComment = async (boardId: string, postId: string, commentId: string) => {
        const postRef = doc(db, `${DB_PREFIX}boards`, boardId, 'posts', postId);
        const postDoc = await getDoc(postRef);
        if (postDoc.exists()) {
            const currentComments = postDoc.data().comments || [];
            const newComments = currentComments.filter((c: Comment) => c.id !== commentId);
            await updateDoc(postRef, { comments: newComments });
        }
    };

    /**
     * Like a post
     */
    const likePost = async (boardId: string, postId: string, newLikes: number) => {
        await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId, 'posts', postId), {
            likes: newLikes
        });
    };

    /**
     * Vote on a poll
     */
    const votePoll = async (boardId: string, postId: string, optionId: string, userId: string) => {
        const postRef = doc(db, `${DB_PREFIX}boards`, boardId, 'posts', postId);

        // We use a transaction to ensure vote integrity
        try {
            await runTransaction(db, async (transaction) => {
                const postDoc = await transaction.get(postRef);
                if (!postDoc.exists()) throw new Error("Post does not exist!");

                const post = postDoc.data() as Post;
                if (!post.poll) throw new Error("This is not a poll!");

                const poll = post.poll;
                const options = poll.options;

                // Check if user already voted on THIS option
                const targetOptionIndex = options.findIndex(o => o.id === optionId);
                if (targetOptionIndex === -1) throw new Error("Option not found");

                const targetOption = options[targetOptionIndex];
                const hasVotedThisOption = targetOption.voters.includes(userId);

                // Check if user voted on ANY option
                const votedOptionIndex = options.findIndex(o => o.voters.includes(userId));

                // Logic:
                // 1. If allowMultiple is false (default):
                //    - If clicking same option -> remove vote (toggle off)
                //    - If clicking different option -> remove from old, add to new (switch)
                //    - If not voted yet -> add vote

                if (!poll.allowMultiple) {
                    if (hasVotedThisOption) {
                        // Toggle off
                        targetOption.voters = targetOption.voters.filter(uid => uid !== userId);
                    } else {
                        // If voted elsewhere, remove it
                        if (votedOptionIndex !== -1) {
                            options[votedOptionIndex].voters = options[votedOptionIndex].voters.filter(uid => uid !== userId);
                        }
                        // Add to new
                        targetOption.voters.push(userId);
                    }
                } else {
                    // Logic for multiple choice (Toggle)
                    if (hasVotedThisOption) {
                        targetOption.voters = targetOption.voters.filter(uid => uid !== userId);
                    } else {
                        targetOption.voters.push(userId);
                    }
                }

                // Recalculate total votes
                poll.totalVotes = options.reduce((acc, curr) => acc + curr.voters.length, 0);

                transaction.update(postRef, { poll: poll });
            });
        } catch (e) {
            console.error("Transaction failed: ", e);
        }
    };

    /**
     * Update section orders
     */
    const reorderSections = async (boardId: string, orderedProjectIds: string[]) => {
        const batch = orderedProjectIds.map((id, index) =>
            updateDoc(doc(db, `${DB_PREFIX}boards`, boardId, 'sections', id), { order: index })
        );
        await Promise.all(batch);
    };

    /**
     * Update post orders (within or across sections)
     */
    const reorderPosts = async (boardId: string, sectionId: string, orderedPostIds: string[]) => {
        const batch = orderedPostIds.map((id, index) =>
            updateDoc(doc(db, `${DB_PREFIX}boards`, boardId, 'posts', id), {
                sectionId, // Update sectionId in case it moved
                order: index
            })
        );
        await Promise.all(batch);
    };

    const createFolder = async (title: string) => {
        if (!authStore.user) return;
        await addDoc(collection(db, `${DB_PREFIX}folders`), {
            title,
            ownerId: authStore.user.uid,
            createdAt: Timestamp.now()
        });
    };

    const deleteFolder = async (folderId: string) => {
        // Move all boards in this folder to root (folderId = null)
        const boardsInFolder = boards.value.filter(b => b.folderId === folderId);
        const updates = boardsInFolder.map(b => updateDoc(doc(db, `${DB_PREFIX}boards`, b.id), { folderId: null }));
        await Promise.all(updates);

        await deleteDoc(doc(db, `${DB_PREFIX}folders`, folderId));
    };

    const moveBoardToFolder = async (boardId: string, folderId: string | null) => {
        await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId), { folderId });
    };

    /**
     * Cleanup subscriptions
     */
    const cleanup = () => {
        if (unsubscribeBoards) unsubscribeBoards();
        if (unsubscribeFolders) unsubscribeFolders();
        if (unsubscribeSections) unsubscribeSections();
        if (unsubscribePosts) unsubscribePosts();
    };

    return {
        // State
        boards,
        folders,
        currentBoard,
        sections,
        posts,
        loading,
        error,

        // Computed
        sortedSections,
        postsBySection,

        // Actions
        subscribeToBoards,
        subscribeToBoard,
        createBoard,
        updateBoard,
        deleteBoard,
        checkBoardPassword,
        createSection,
        createPost,
        updatePost,
        deletePost,
        approvePost,
        approveAll,
        likePost,
        addComment,
        deleteComment,
        approveComment,
        reorderSections,
        deleteSection,
        reorderPosts,
        createFolder,
        deleteFolder,
        moveBoardToFolder,
        votePoll,
        cleanup
    };
});
