<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import QrcodeVue from 'qrcode.vue';
import draggable from 'vuedraggable';
import { useBoardStore, type Post, type Section, type Board } from '../stores/board';
import { useAuthStore } from '../stores/auth';
import { useCloudinary } from '../composables/useCloudinary';
import { useModal } from '../composables/useModal';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppConfig, DB_PREFIX } from '../composables/useAppConfig';

// Components
import BoardHeader from '../components/BoardHeader.vue';
import PostCard from '../components/PostCard.vue';
import PostEditor from '../components/PostEditor.vue';

// Composables
import { usePostActions } from '../composables/usePostActions';
import { useBoardSettings } from '../composables/useBoardSettings';
import { useSlideshow } from '../composables/useSlideshow';

// 1. Basic State & Refs
const route = useRoute();
const router = useRouter();
const boardStore = useBoardStore();
const authStore = useAuthStore();
const boardId = computed(() => route.params.id as string);
const currentBoard = ref<Board | null>(null);
const isLoading = ref(true);
const isPasswordVerified = ref(false);
const guestName = ref(sessionStorage.getItem('ahmo_guest_name') || '');
const guestNameInput = ref('');
const showGuestNameModal = ref(false);
const pendingAction = ref<(() => void) | null>(null);

const isOwner = computed(() => currentBoard.value?.ownerId === authStore.user?.uid);
const canContribute = computed(() => {
    if (isOwner.value) return true;
    if (!currentBoard.value) return false;
    if (currentBoard.value.privacy === 'private') return false;
    return (currentBoard.value.guestPermission || 'edit') !== 'view';
});

// 2. Composables Instances
const postActions = usePostActions(boardId.value);
const boardSettings = useBoardSettings(boardId.value);

const { 
  uploadFile, 
  isUploading: cloudinaryUploading,
  uploadProgress
} = useCloudinary();
const { config: appConfig } = useAppConfig();
const modal = useModal();

// 3. UI Helper States
const POST_COLORS = [
    { name: '預設', value: '#ffffff' },
    { name: '灰藍', value: '#d1dce5' },
    { name: '藕粉', value: '#e2d1d1' },
    { name: '萌綠', value: '#d5e0d5' },
    { name: '米黃', value: '#eee8d5' },
    { name: '灰紫', value: '#ddd5e2' },
    { name: '陶土', value: '#e5dcd1' },
    { name: '海霧', value: '#d1e5e2' },
    { name: '煙燻', value: '#e5e5e5' },
];

const currentSort = ref('manual');
const sortOptions = [
  { label: '自訂排序', value: 'manual' },
  { label: '時間 (新→舊)', value: 'newest' },
  { label: '時間 (舊→新)', value: 'oldest' },
  { label: '標題 (A→Z)', value: 'title-asc' },
  { label: '標題 (Z→A)', value: 'title-desc' },
  { label: '作者 (A→Z)', value: 'author-asc' },
  { label: '作者 (Z→A)', value: 'author-desc' }
];

const showSettingsModal = ref(false);
const showShareModal = ref(false);
const showPasswordModal = ref(false);
const passwordInput = ref('');
const passwordError = ref('');
const dragTargetPostId = ref<string | null>(null);
const dragTargetSectionId = ref<string | null>(null);
const isDraggingOver = ref(false);
const accessDeniedType = ref<'none' | 'private'>('none');

const isAddingSection = ref(false);
const newSectionName = ref('');
const editingSectionId = ref<string | null>(null);
const editTitle = ref('');
const editDesc = ref('');
const editingBoardTitle = ref(false);
const editingBoardDesc = ref(false);

const activeSection = ref<string | null>(null);
const newPostTitle = ref('');
const newPostContent = ref('');
const newPostColor = ref('#ffffff');
const pendingAttachments = ref<any[]>([]);
const isPoll = ref(false);
const pollOptions = ref([{ id: '1', text: '' }, { id: '2', text: '' }]);
const editingPostId = ref<string | null>(null);
const editPostTitle = ref('');
const editContent = ref('');
const editPostColor = ref('#ffffff');
const editPollOptions = ref<any[]>([]);

const previewUrl = ref<string | null>(null);
const previewType = ref<'image' | 'video' | 'pdf' | 'link' | 'youtube' | 'audio' | null>(null);
const previewOriginalUrl = ref<string | null>(null);
const showYouTubeInput = ref(false);
const youtubeUrlInput = ref('');
const settingsTab = ref('basic');
const unsplashSearchQuery = ref('');
const isSearchingUnsplash = ref(false);
const unsplashResults = ref<string[]>([]);
const isUploadingBackground = ref(false);
const backgroundFileInput = ref<HTMLInputElement | null>(null);
const customBackgrounds = ref<any[]>([]);
const whitelistInput = ref('');
const isCopyingConfig = ref(false);

const SETTINGS_TABS = [
  { id: 'basic', label: '基本與簡介', icon: 'M13 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V9l-7-7zM13 9V3.5L18.5 9H13z' },
  { id: 'visual', label: '外觀與背景', icon: 'M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8' }
];

const isInternalDragging = ref(false);

const contentRefs = reactive<Record<string, HTMLTextAreaElement | null>>({});
const newSectionInput = ref<HTMLInputElement | null>(null);

// 4. Computed Properties
const canEdit = computed(() => isOwner.value);
const allFlatPosts = computed(() => boardStore.posts);
const localSections = computed({
    get: () => boardStore.sections,
    set: (val: Section[]) => { 
        // We let the @change handler call the store, but we need a setter to allow vuedraggable's internal logic
    }
});
const localWallPosts = computed(() => boardStore.posts);
const localPostsBySection = ref<Record<string, Post[]>>({});
watch([() => boardStore.posts, () => boardStore.sections, currentSort], () => {
    const map: Record<string, Post[]> = {};
    const sections = boardStore.sections;
    const allPosts = boardStore.posts;

    sections.forEach(sec => {
        let sectionPosts = allPosts.filter(p => p.sectionId === sec.id);
        
        switch (currentSort.value) {
            case 'newest':
                sectionPosts.sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
                break;
            case 'oldest':
                sectionPosts.sort((a, b) => (a.createdAt?.getTime?.() || 0) - (b.createdAt?.getTime?.() || 0));
                break;
            case 'title-asc':
                sectionPosts.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
                break;
            case 'title-desc':
                sectionPosts.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
                break;
            case 'author-asc':
                sectionPosts.sort((a, b) => (a.author.displayName || '').localeCompare(b.author.displayName || ''));
                break;
            case 'author-desc':
                sectionPosts.sort((a, b) => (b.author.displayName || '').localeCompare(a.author.displayName || ''));
                break;
            case 'manual':
            default:
                sectionPosts.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                break;
        }
        map[sec.id] = sectionPosts;
    });
    localPostsBySection.value = map;
}, { immediate: true, deep: true });
const pendingCount = computed(() => boardStore.posts.filter((p: Post) => p.status === 'pending').length);

const slideshow = useSlideshow(currentBoard, localSections, computed(() => boardStore.postsBySection));
const { 
    showSlideshow, 
    slides, 
    currentSlide, 
    currentSlideIndex, 
    isPlaying, 
    togglePlayPause, 
    toggleFullscreen, 
    closeSlideshow, 
    nextSlide, 
    prevSlide
} = slideshow;

// 5. Core Methods
const loadBoard = async () => {
    isLoading.value = true;
    try {
        const boardDoc = await getDoc(doc(db, `${DB_PREFIX}boards`, boardId.value));
        if (boardDoc.exists()) {
            const boardData = {
                id: boardDoc.id,
                ...boardDoc.data(),
                createdAt: boardDoc.data().createdAt?.toDate ? boardDoc.data().createdAt.toDate() : new Date(),
                privacy: boardDoc.data().privacy || 'public',
                guestPermission: boardDoc.data().guestPermission || 'edit'
            } as Board;

            if (!isOwner.value && boardData.privacy === 'private') {
                accessDeniedType.value = 'private';
                isLoading.value = false;
                return;
            }

            currentBoard.value = boardData;
            boardStore.currentBoard = boardData;
            document.title = (appConfig.appTitle || '阿墨互動牆') + ' - ' + boardData.title;
            boardStore.subscribeToBoard(boardId.value);
        } else {
            modal.error('看板不存在');
            router.push('/');
        }
    } catch (err) {
        console.error(err);
    } finally {
        isLoading.value = false;
    }
};

const requireGuestName = (action: () => void) => {
    if (authStore.user || guestName.value) { action(); }
    else { pendingAction.value = action; showGuestNameModal.value = true; }
};

const confirmGuestName = () => {
    if (guestNameInput.value.trim()) {
        guestName.value = guestNameInput.value.trim();
        sessionStorage.setItem('ahmo_guest_name', guestName.value);
        showGuestNameModal.value = false;
        if (pendingAction.value) { pendingAction.value(); pendingAction.value = null; }
    }
};

const goHome = () => router.push('/');

// 6. UI Handlers
const handleSortUpdate = async (val: string) => {
    currentSort.value = val;
    if (isOwner.value && boardId.value) {
        await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId.value), { defaultSort: val });
    }
};

const handleVote = (post: Post, optionId: string) => postActions.handleVote(post, optionId, guestName.value, (action) => requireGuestName(action));
const handleLike = (post: Post) => postActions.handleLike(post);
const handleApprovePost = (postId: string) => postActions.handleApprovePost(postId);
const handleBatchApprove = () => postActions.handleBatchApprove(pendingCount.value, boardStore.posts);
const handleDelete = (post: Post) => postActions.handleDelete(post);
const handleComment = (postId: string, content: string) => postActions.handleComment(postId, content, guestName.value, (action) => requireGuestName(action));

const handleDragOver = (e: DragEvent) => { 
    if (isInternalDragging.value) return;
    if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault(); 
        isDraggingOver.value = true; 
    }
};
const handleDragLeave = () => { isDraggingOver.value = false; };
const handleDrop = (e: DragEvent) => { 
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault(); 
    isDraggingOver.value = false;
    if (dragTargetPostId.value || dragTargetSectionId.value) return;
    if (!canContribute.value) return;
    const targetSectionId = activeSection.value || (localSections.value[0]?.id);
    if (targetSectionId) handleNewPostDrop(targetSectionId, e);
};

const handlePostDragOver = (postId: string, e: DragEvent) => { 
    if (isInternalDragging.value) return;
    if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault(); 
        dragTargetPostId.value = postId; 
    }
};
const handlePostDrop = async (post: Post, e: DragEvent) => { 
    e.preventDefault(); 
    dragTargetPostId.value = null; 
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    for (let i = 0; i < files.length; i++) {
        const res = await uploadFile(files[i], `ahmo-wall/${currentBoard.value?.title || 'Shared'}`);
        if (res) {
            const attachments = [...(post.attachments || []), {
                type: (files[i].type.startsWith('image/') ? 'image' : 'link') as any,
                url: res.url,
                publicId: res.publicId,
                name: files[i].name
            }];
            await boardStore.updatePost(boardId.value, post.id, { attachments });
        }
    }
};

const handleNewPostDrop = async (sectionId: string, e: DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    activeSection.value = sectionId;
    for (let i = 0; i < files.length; i++) {
        const res = await uploadFile(files[i], `ahmo-wall/${currentBoard.value?.title || 'Shared'}`);
        if (res) {
            pendingAttachments.value.push({
                type: files[i].type.startsWith('image/') ? 'image' : 'link',
                url: res.url,
                publicId: res.publicId,
                name: files[i].name
            });
        }
    }
};

const submitPost = async (sectionId: string) => {
    if (!newPostContent.value && !pendingAttachments.value.length && !isPoll.value) return;
    requireGuestName(async () => {
        const postData = {
            sectionId,
            title: newPostTitle.value,
            content: newPostContent.value,
            attachments: [...pendingAttachments.value],
            color: newPostColor.value,
            likes: 0
        };
        if (isPoll.value) {
            (postData as any).poll = {
                question: newPostTitle.value || '投票',
                options: pollOptions.value.filter(o => o.text.trim()).map(o => ({ id: o.id, text: o.text, voters: [] })),
                totalVotes: 0
            };
        }
        await boardStore.createPost(boardId.value, postData as any, guestName.value);
        newPostTitle.value = ''; newPostContent.value = ''; pendingAttachments.value = []; isPoll.value = false; activeSection.value = null;
    });
};

const startEditPost = (post: Post) => {
    editingPostId.value = post.id;
    editPostTitle.value = post.title || '';
    editContent.value = post.content || '';
    editPostColor.value = post.color || '#ffffff';
    if (post.poll) {
        editPollOptions.value = JSON.parse(JSON.stringify(post.poll.options));
    } else {
        editPollOptions.value = [];
    }
};

const saveEditPost = async (post: Post) => {
    const updateData: any = {
        title: editPostTitle.value,
        content: editContent.value,
        color: editPostColor.value
    };
    if (post.poll && editPollOptions.value.length) {
        updateData.poll = {
            ...post.poll,
            options: editPollOptions.value.filter(o => o.text.trim())
        };
    }
    await boardStore.updatePost(boardId.value, post.id, updateData);
    editingPostId.value = null;
    editPollOptions.value = [];
};

const deleteAttachment = async (post: Post, attachmentIdx: number) => {
    const confirmed = await modal.confirm('確定要刪除附件嗎？');
    if (!confirmed) return;
    const newAttachments = [...(post.attachments || [])];
    newAttachments.splice(attachmentIdx, 1);
    await boardStore.updatePost(boardId.value, post.id, { attachments: newAttachments });
};

const verifyPassword = () => {
    if (passwordInput.value === currentBoard.value?.password) {
        isPasswordVerified.value = true;
        sessionStorage.setItem(`ahmo_board_pw_${boardId.value}`, 'verified');
        showPasswordModal.value = false;
    } else { passwordError.value = '密碼錯誤'; }
};

const clearGuestName = () => { guestName.value = ''; sessionStorage.removeItem('ahmo_guest_name'); };
const removePendingAttachment = (idx: number) => { pendingAttachments.value.splice(idx, 1); };
const openShareModal = () => { showShareModal.value = true; };

const addPollOption = () => { pollOptions.value.push({ id: Date.now().toString(), text: '' }); };
const removePollOption = (idx: number) => { pollOptions.value.splice(idx, 1); };

const createSection = () => {
    isAddingSection.value = true;
    newSectionName.value = '';
    nextTick(() => { newSectionInput.value?.focus(); });
};

const cancelAddingSection = () => { isAddingSection.value = false; newSectionName.value = ''; };

const confirmCreateSection = async () => {
    if (!newSectionName.value.trim()) { isAddingSection.value = false; return; }
    await boardStore.createSection(boardId.value, newSectionName.value.trim());
    isAddingSection.value = false;
    newSectionName.value = '';
};

const activeSectionMenuId = ref<string | null>(null);
const toggleSectionMenu = (id: string) => { activeSectionMenuId.value = activeSectionMenuId.value === id ? null : id; };
const closeSectionMenu = () => { activeSectionMenuId.value = null; };

const startEditSection = (section: Section) => {
    editingSectionId.value = section.id;
    editTitle.value = section.title;
};

const saveEditSection = async (section: Section) => {
    if (editTitle.value.trim() && editTitle.value !== section.title) {
        await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId.value, 'sections', section.id), { title: editTitle.value.trim() });
    }
    editingSectionId.value = null;
};

const handleDeleteSection = async (id: string) => {
    const confirmed = await modal.confirm('確定要刪除區段嗎？內容也會被刪除。');
    if (confirmed) {
        await boardStore.deleteSection(boardId.value, id);
    }
};

const startEditBoardTitle = () => { editTitle.value = currentBoard.value?.title || ''; editingBoardTitle.value = true; };
const saveEditBoardTitle = async () => {
    if (editTitle.value.trim() && editTitle.value !== currentBoard.value?.title) {
        await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId.value), { title: editTitle.value.trim() });
    }
    editingBoardTitle.value = false;
};

const startEditBoardDesc = () => { editDesc.value = currentBoard.value?.description || ''; editingBoardDesc.value = true; };
const saveEditBoardDesc = async () => {
    await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId.value), { description: editDesc.value.trim() });
    editingBoardDesc.value = false;
};

const formatRelativeTime = (date: Date) => {
    if (!date) return '剛剛';
    const d = date instanceof Date ? date : (date as any).toDate ? (date as any).toDate() : new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 30000) return '剛剛';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`;
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString();
};

const handleImageError = (author: any) => { if (author && author.photoURL) author.photoURL = ''; };
const getViewUrl = (url: string) => url;
const isLiked = (postId: string) => !!localStorage.getItem(`ahmo_liked_${postId}`);
const formatContent = (text: string) => text;

// --- Post Navigation & Expansion ---
const expandedPostId = ref<string | null>(null);
const expandedPost = computed(() => boardStore.posts.find(p => p.id === expandedPostId.value) || null);
const expandedPostIndex = computed(() => boardStore.posts.findIndex(p => p.id === expandedPostId.value));

const openPostDetail = (post: Post) => { expandedPostId.value = post.id; };
const closePostDetail = () => { expandedPostId.value = null; };

const navigatePost = (dir: 'next' | 'prev') => {
    const idx = expandedPostIndex.value;
    if (dir === 'next' && idx < boardStore.posts.length - 1) {
        expandedPostId.value = boardStore.posts[idx + 1].id;
    } else if (dir === 'prev' && idx > 0) {
        expandedPostId.value = boardStore.posts[idx - 1].id;
    }
};

const likedPosts = reactive<Record<string, boolean>>({});
const expandedComments = reactive<Record<string, boolean>>({});
const expandedPostsInList = reactive<Record<string, boolean>>({});
const commentInputs = reactive<Record<string, string>>({});

const toggleExpandComments = (postId: string) => { expandedComments[postId] = !expandedComments[postId]; };
const toggleComments = (post: Post) => { toggleExpandComments(post.id); };

const submitComment = async (post: Post) => {
    const content = commentInputs[post.id]?.trim();
    if (!content) return;
    await postActions.handleComment(post.id, content, guestName.value, (action: () => void) => requireGuestName(action));
    commentInputs[post.id] = '';
};

const handleDeleteComment = async (post: Post, commentId: string) => {
    const confirmed = await modal.confirm('確定要刪除留言嗎？');
    if (confirmed) {
        await postActions.handleDeleteComment(post.id, commentId);
    }
};

const cancelEditPost = () => { editingPostId.value = null; };
const focusElement = (id: string) => { nextTick(() => document.getElementById(id)?.focus()); };

const getVideoThumbnail = (url: string) => {
    if (url.includes('cloudinary')) {
        return url.replace(/\.[^/.]+$/, '.jpg');
    }
    return '';
};

const openPreview = (url: string, type: 'image' | 'video' | 'pdf' | 'link' | 'youtube' | 'audio' = 'image', originalUrl?: string) => {
    previewUrl.value = url;
    previewType.value = type;
    previewOriginalUrl.value = originalUrl || url;
};

const openLink = (url: string, type: string) => {
    window.open(url, '_blank');
};

const searchUnsplash = async () => {
    if (!unsplashSearchQuery.value.trim()) return;
    isSearchingUnsplash.value = true;
    const query = encodeURIComponent(unsplashSearchQuery.value.trim());
    // Use reliable stock photography first to avoidbot-like placeholders
    unsplashResults.value = [
        // Real Photos (LoremFlickr) - Append 'scenery' for better results
        `https://loremflickr.com/1920/1080/${query},scenery?random=1`,
        `https://loremflickr.com/1920/1080/${query},nature?random=2`,
        `https://loremflickr.com/1920/1080/${query},wallpaper?random=3`,
        // High Quality Direct Unsplash Links
        `https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1920&h=1080&q=80`,
        `https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1920&h=1080&q=80`,
        // AI as a last resort with very descriptive scenery enforcement
        `https://image.pollinations.ai/prompt/stunning%20wide%20shot%20of%20${query}%20nature%20background%204k?width=1920&height=1080&nologo=true&seed=${Math.floor(Math.random() * 1000)}`,
        `https://image.pollinations.ai/prompt/artistic%20abstract%20wallpaper%20of%20${query}%20cinematic?width=1920&height=1080&nologo=true&seed=${Math.floor(Math.random() * 1000) + 1}`
    ];
    isSearchingUnsplash.value = false;
};

const selectUnsplashImage = (url: string) => {
    if (currentBoard.value) {
        currentBoard.value.backgroundImage = url;
    }
};

const handleBackgroundUpload = async (e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files?.length) return;
    isUploadingBackground.value = true;
    try {
        const res = await uploadFile(files[0], 'ahmo-wall-bg');
        if (res && currentBoard.value) {
            currentBoard.value.backgroundImage = res.url;
            customBackgrounds.value.push({ id: Date.now().toString(), url: res.url, publicId: res.publicId });
        }
    } finally {
        isUploadingBackground.value = false;
        (e.target as HTMLInputElement).value = '';
    }
};

const handleDeleteBackground = (id: string, publicId?: string) => {
    // If we have a publicId, we could technically call Cloudinary delete, 
    // but for now we just remove it from the local board state which is synced.
    customBackgrounds.value = customBackgrounds.value.filter(bg => bg.id !== id);
    if (currentBoard.value?.backgroundImage?.includes(id) || (publicId && currentBoard.value?.backgroundImage?.includes(publicId))) {
        currentBoard.value.backgroundImage = '';
    }
};

const saveBoardSettings = async () => {
    if (!currentBoard.value) return;
    const success = await boardSettings.saveBoardSettings(currentBoard.value);
    if (success) showSettingsModal.value = false;
};

const saveGlobalSettings = () => boardSettings.saveGlobalSettings(isOwner.value);
const saveCloudinaryConfig = () => boardSettings.saveCloudinaryConfig(isOwner.value);
const saveSettings = saveBoardSettings;

const generateShareLink = () => {
    return window.location.href;
};

const copyLink = async () => {
    try {
        await navigator.clipboard.writeText(generateShareLink());
        isCopyingConfig.value = true;
        setTimeout(() => isCopyingConfig.value = false, 2000);
    } catch (err) {
        modal.error('複製連結失敗');
    }
};

const confirmAddYouTube = () => {
    if (!youtubeUrlInput.value.trim()) { showYouTubeInput.value = false; return; }
    const url = youtubeUrlInput.value.trim();
    let videoId = '';
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
        videoId = match[2];
        const shareUrl = `https://www.youtube.com/embed/${videoId}`;
        const attachment = {
            type: 'youtube',
            url: url,
            shareUrl: shareUrl,
            name: 'YouTube Video'
        };
        pendingAttachments.value.push(attachment);
    } else {
        modal.error('無效的 YouTube 連結');
    }
    youtubeUrlInput.value = '';
    showYouTubeInput.value = false;
};

const deleteBoard = async () => {
    const confirmed = await modal.confirm('您確定要永久刪除此看板嗎？此操作不可復原。');
    if (!confirmed) return;
    try {
        await deleteDoc(doc(db, `${DB_PREFIX}boards`, boardId.value));
        modal.success('看板已刪除');
        router.push('/');
    } catch (err) {
        modal.error('刪除失敗');
    }
};

const updateWhitelist = () => {
    appConfig.allowedEmails = whitelistInput.value.split(',').map(e => e.trim()).filter(e => e);
};

const currentUrl = computed(() => window.location.href);

const submitPassword = verifyPassword;

const handleFileSelect = async (e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files?.length) return;
    const sectionId = activeSection.value || (localSections.value[0]?.id);
    if (!sectionId) return;
    
    for (let i = 0; i < files.length; i++) {
        const res = await uploadFile(files[i], `ahmo-wall/${currentBoard.value?.title || 'Shared'}`);
        if (res) {
            pendingAttachments.value.push({
                type: files[i].type.startsWith('image/') ? 'image' : 
                      files[i].type.startsWith('video/') ? 'video' :
                      files[i].type === 'application/pdf' ? 'pdf' : 'link',
                url: res.url,
                publicId: res.publicId,
                name: files[i].name,
                thumbnailUrl: res.thumbnailUrl
            });
        }
    }
    (e.target as HTMLInputElement).value = '';
};

const saveGuestName = confirmGuestName;
const fileInput = ref<HTMLInputElement | null>(null);
const cameraInput = ref<HTMLInputElement | null>(null);

// 7. Lifecycle & Watchers
onMounted(async () => {
    loadBoard();
    boardSettings.loadGlobalSettings();
});

onUnmounted(() => { boardStore.cleanup(); });

watch(() => route.params.id, (newId) => {
    if (newId) {
        loadBoard();
    }
}, { immediate: true });
</script>

<template>
  <div class="h-screen bg-cover bg-center bg-no-repeat bg-fixed flex flex-col font-sans overflow-hidden transition-all duration-500 relative"
       @dragover.prevent="handleDragOver"
       @dragleave="handleDragLeave"
       @drop.prevent="handleDrop"
       @click="closeSectionMenu"
       :style="{ 
         backgroundImage: currentBoard?.backgroundImage ? `url(${currentBoard.backgroundImage})` : '',
         backgroundColor: currentBoard?.backgroundColor || '#1a1a2e'
       }">
    
    <!-- Drag & Drop Overlay -->
    <div v-if="isDraggingOver" 
         class="absolute inset-0 z-[100] bg-emerald-600/40 backdrop-blur-md flex items-center justify-center pointer-events-none">
      <div class="bg-white p-12 rounded-[2.5rem] shadow-2xl scale-110 border-4 border-dashed border-emerald-500 animate-[bounce-custom_2s_infinite] flex flex-col items-center">
        <div class="text-emerald-500 mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </div>
        <p class="text-2xl font-bold text-gray-800 tracking-tight">放置檔案以開始上傳</p>
        <p class="text-gray-500 mt-2 font-medium">檔案將上傳至當前或第一個區段</p>
      </div>
    </div>

    <!-- Upload Progress Overlay -->
    <transition name="fade">
      <div v-if="cloudinaryUploading" 
           class="fixed inset-0 z-[150] bg-black/60 backdrop-blur-md flex items-center justify-center px-4">
        <div class="bg-white p-10 rounded-[2rem] shadow-2xl w-full max-w-md transform scale-100 transition-all border border-emerald-100">
          <div class="flex items-center justify-between mb-6">
            <span class="text-lg font-bold text-gray-800 flex items-center gap-3">
              <span class="flex items-center justify-center w-8 h-8 bg-emerald-100 text-emerald-600 rounded-lg animate-pulse">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.71-2.13.71-2.13s-1.29 0-2.13-.71c-.87-.73-.58-1.58-.58-1.58z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.5-1 1-4c1.5 0 3 0 3 0s.5-1.5 0-3c3 1 4 5 4 5"/></svg>
              </span>
              正在上傳檔案...
            </span>
            <span class="text-base font-black text-emerald-600 tabular-nums">{{ uploadProgress }}%</span>
          </div>
          <div class="w-full h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
            <div class="h-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                 :style="{ width: `${uploadProgress}%` }"></div>
          </div>
          <p class="text-gray-400 text-xs text-center">請勿關閉視窗，等待上傳完成</p>
        </div>
      </div>
    </transition>
    
    <!-- Loading State -->
    <div v-if="isLoading" class="flex-1 flex items-center justify-center bg-gray-900">
      <div class="text-center">
        <div class="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p class="text-white/60">載入中...</p>
      </div>
    </div>
    
    <!-- Main Content -->
    <template v-else>
      <!-- Overlay -->
      <div class="absolute inset-0 bg-slate-950/20 pointer-events-none z-0"></div>

      <!-- Header -->
      <BoardHeader 
        :current-board="currentBoard"
        :current-user="authStore.user"
        :is-owner="isOwner"
        :can-contribute="canContribute"
        :pending-count="pendingCount"
        :current-sort="currentSort"
        :sort-options="sortOptions"
        :editing-board-title="editingBoardTitle"
        :editing-board-desc="editingBoardDesc"
        :edit-title="editTitle"
        :edit-desc="editDesc"
        @go-home="goHome"
        @open-share-modal="openShareModal"
        @open-settings-modal="showSettingsModal = true"
        @handle-batch-approve="postActions.handleBatchApprove(pendingCount, boardStore.posts)"
        @create-section="createSection"
        @start-slideshow="slideshow.startSlideshow"
        @update-sort="handleSortUpdate"
        @start-edit-title="startEditBoardTitle"
        @save-edit-title="saveEditBoardTitle"
        @update-title="editTitle = $event"
        @start-edit-desc="startEditBoardDesc"
        @save-edit-desc="saveEditBoardDesc"
        @update-desc="editDesc = $event"
      />
      
      <!-- Access Denied UI -->
      <Teleport to="body">
        <div v-if="accessDeniedType === 'private'" class="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/95 backdrop-blur-3xl">
            <div class="bg-gray-900 border border-white/5 p-12 rounded-[2.5rem] text-center max-w-lg w-full shadow-2xl animate-fade-in-up flex flex-col items-center">
                <div class="w-24 h-24 bg-red-500/10 text-red-500 rounded-3xl flex items-center justify-center mb-8 border border-red-500/20 shadow-lg shadow-red-900/20">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                </div>
                <h2 class="text-3xl font-black text-white mb-4 tracking-tight">存取權限受阻</h2>
                <p class="text-gray-400 mb-10 text-lg font-medium leading-relaxed">此看板目前設定為「私密狀態」或是您未獲得授權，僅擁有者可以檢視內容。</p>
                <button @click="$router.push('/')" class="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black transition-all transform hover:scale-[1.02] active:scale-95 shadow-xl shadow-emerald-900/40 flex items-center justify-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                  返回首頁控制台
                </button>
            </div>
        </div>
      </Teleport>

      <!-- Shelf Layout -->
      <main v-if="currentBoard && accessDeniedType === 'none' && !showPasswordModal && (currentBoard.layout === 'shelf' || !currentBoard.layout)" 
            @drop.prevent="handleDrop" 
            @dragover.prevent="handleDragOver" 
            @dragleave="handleDragLeave"
            class="flex-1 overflow-x-auto overflow-y-hidden p-8 gap-8 flex items-start">
        
        <!-- Empty State Guide -->
        <div v-if="localSections.length === 0 && isOwner" 
             class="flex-1 flex flex-col items-center justify-center h-full min-h-[400px] animate-fade-in">
          <div class="w-32 h-32 bg-white/5 border border-white/5 rounded-[3rem] flex items-center justify-center text-6xl mb-8 shadow-2xl backdrop-blur-xl animate-bounce-slow">
            🏗️
          </div>
          <h2 class="text-3xl font-black text-white mb-4 tracking-tight">打造您的第一個區段</h2>
          <p class="text-slate-400 mb-10 text-lg font-medium text-center max-w-md leading-relaxed">在這個空間裡，您可以按主題或進度分欄。點擊右側的按鈕開始您的創作之旅！</p>
          <div v-if="isAddingSection" class="w-80 bg-white/10 backdrop-blur-md rounded-[2rem] p-6 border border-emerald-500/50 shadow-2xl animate-scale-in">
            <input ref="newSectionInput"
                   v-model="newSectionName" 
                   @keydown.enter="confirmCreateSection"
                   @keydown.esc="cancelAddingSection"
                   @blur="confirmCreateSection"
                   placeholder="輸入欄位名稱..." 
                   class="w-full bg-white/10 text-white font-bold px-4 py-3 rounded-xl outline-none border border-white/10 focus:border-emerald-500 transition-all placeholder-white/30"
                   autofocus />
            <div class="flex justify-end gap-2 mt-4">
              <button @click="cancelAddingSection" class="px-4 py-2 text-xs text-gray-400 hover:text-white font-bold transition-colors">取消</button>
              <button @click="confirmCreateSection" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-xl font-bold shadow-lg transition-all">建立</button>
            </div>
          </div>
          <button v-else @click="createSection" 
                  class="px-10 py-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-[2rem] font-black text-xl transition-all shadow-2xl shadow-emerald-900/40 active:scale-95 flex items-center gap-4">
            <span class="text-3xl">+</span>
            立即新增區段
          </button>
        </div>
        
        <!-- Sections (Columns) -->
        <draggable 
           v-model="localSections"
           item-key="id"
           class="flex gap-6 items-start h-full"
           handle=".section-drag-handle"
           :disabled="!isOwner"
           @start="isInternalDragging = true"
           @end="isInternalDragging = false"
           @change="(evt: any) => {
             if (evt.moved) {
               boardStore.reorderSections(boardId, localSections.map(s => s.id));
             }
           }"
        >
          <template #item="{ element: section }">
            <div class="flex-shrink-0 w-[80vw] sm:w-[260px] md:w-[280px] flex flex-col max-h-full bg-slate-900/60 backdrop-blur-xl rounded-[2rem] border border-white/5 overflow-hidden shadow-lg transition-transform duration-300 hover:border-white/10 will-change-transform">
              <!-- Section Header (Padlet Style) -->
              <div class="relative group/shead flex flex-col p-4 pb-0"
                   :style="{ borderTopColor: section.color, borderTopWidth: '4px' }">
                
                <div class="flex justify-between items-start gap-2 mb-2">
                  <input v-if="editingSectionId === section.id"
                         :id="`edit-section-${section.id}`"
                         v-model="editTitle"
                         @blur="saveEditSection(section)"
                         @keydown.enter="saveEditSection(section)"
                         class="bg-transparent border-b border-white text-lg font-bold text-white w-full outline-none"
                  />
                  <h2 v-else @dblclick="startEditSection(section)" 
                      class="font-bold text-white text-lg cursor-pointer hover:bg-white/5 rounded-lg px-2 py-1 transition-colors flex-1 break-words leading-snug tracking-tight"
                      :title="section.title">
                      {{ section.title }}
                  </h2>
                  
                  <div class="flex items-center">
                    <button @click.stop="toggleSectionMenu(section.id)"
                            class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-all active:scale-90 flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                    </button>
                  </div>
                </div>

                <!-- Section Menu Dropdown -->
                <div v-if="activeSectionMenuId === section.id" 
                     class="absolute right-4 top-14 w-48 bg-gray-900 rounded-xl shadow-2xl border border-white/10 z-50 overflow-hidden animate-scale-in origin-top-right">
                    <button @click="activeSection = section.id; closeSectionMenu()" class="w-full text-left px-4 py-3 text-xs font-bold text-gray-300 hover:bg-emerald-500/10 hover:text-emerald-400 flex items-center gap-3 transition-all group/menuitem">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover/menuitem:rotate-90 transition-transform"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                      新增貼文
                    </button>
                    <div class="h-px bg-white/5 mx-2"></div>
                    <button v-if="canEdit" @click="startEditSection(section); closeSectionMenu()" class="w-full text-left px-4 py-3 text-xs font-bold text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-3 transition-all group/menuitem">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="group-hover/menuitem:rotate-12 transition-transform"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                      重新命名
                    </button>
                    <button v-if="canEdit" @click="handleDeleteSection(section.id); closeSectionMenu()" class="w-full text-left px-4 py-3 text-xs font-bold text-red-400 hover:bg-red-500/10 hover:text-red-300 flex items-center gap-3 transition-all group/menuitem border-t border-white/5">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="group-hover/menuitem:-rotate-12 transition-transform"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                      刪除區段
                    </button>
                </div>

                <!-- Inline Add Bar (Compressed) -->
                <button v-if="canContribute" @click="activeSection = section.id" 
                        class="mt-2 w-full h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 text-white/20 hover:text-white/60 border border-white/5 transition-all active:scale-[0.98] group/addbar"
                        title="在此區段新增貼文">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover/addbar:scale-110 transition-transform opacity-30 group-hover:opacity-100"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                </button>
                
                <!-- Posts count removed as per request -->
              </div>

              <!-- Posts Container -->
              <div class="flex-1 overflow-y-auto p-3 space-y-4">
                
                <!-- Inline Post Form (Moved to top) -->
                <div v-if="activeSection === section.id" class="mb-5 bg-white rounded-xl p-3 shadow-lg animate-scale-in border-2 border-emerald-500">
                  <input v-model="newPostTitle" 
                         type="text" 
                         :placeholder="isPoll ? '投票問題...' : '標題 (選填)...'" 
                         :id="`input-${section.id}`"
                          class="w-full text-sm font-black text-slate-900 placeholder-slate-400 bg-transparent outline-none mb-2"
                         @keydown.enter.prevent="contentRefs[section.id]?.focus()">
                  


                   <!-- Poll Options Input -->
                   <div v-if="isPoll" class="space-y-2 mb-3 bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <div v-for="(option, idx) in pollOptions" :key="option.id" class="flex items-center gap-2">
                          <span class="text-xs font-bold text-slate-400 w-4 flex-shrink-0 text-center">{{ idx + 1 }}.</span>
                          <input v-model="option.text" type="text" :placeholder="`選項 ${idx + 1}`" class="flex-1 w-full min-w-0 bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-emerald-400 transition-colors" />
                          <button @click="removePollOption(idx)" class="text-slate-300 hover:text-red-400 p-1" :disabled="pollOptions.length <= 2">
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                      </div>
                      <button @click="addPollOption" class="w-full py-1.5 border border-dashed border-slate-300 rounded text-slate-400 text-xs font-bold hover:bg-white hover:text-emerald-500 hover:border-emerald-300 transition-all flex items-center justify-center gap-1">
                          + 新增選項
                      </button>
                   </div>
                  
                   <!-- Color Picker for New Post -->
                   <div class="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-hide">
                      <button v-for="color in POST_COLORS" :key="color.value"
                              @mousedown.prevent="newPostColor = color.value"
                              class="w-5 h-5 rounded-full border border-gray-200 transition-transform hover:scale-110 flex-shrink-0"
                              :class="{ 'ring-2 ring-emerald-500 ring-offset-1': newPostColor === color.value }"
                              :style="{ backgroundColor: color.value }"
                              :title="color.name">
                      </button>
                   </div>
                  
                  <textarea v-model="newPostContent" 
                            :ref="(el) => { if(el) contentRefs[section.id] = el as HTMLTextAreaElement }"
                            :style="{ backgroundColor: newPostColor !== '#ffffff' ? newPostColor : '#ffffff' }"
                            :placeholder="isPoll ? '補充說明 (選填)...' : '輸入內容...'" 
                            class="w-full text-sm text-slate-900 font-bold placeholder-slate-500 bg-transparent outline-none resize-none h-20 mb-2"
                            @keydown.ctrl.enter="submitPost(section.id)"></textarea>
                  
                  <!-- Attachments Preview -->
                  <div v-if="pendingAttachments.length" class="flex gap-2 mt-2 flex-wrap pb-2 mb-2 border-b border-gray-100">
                    <div v-for="(att, idx) in pendingAttachments" :key="idx" 
                         class="relative w-16 h-16 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 group">
                      <img v-if="att.thumbnailUrl" 
                           :src="att.type === 'image' ? getViewUrl(att.url) : att.thumbnailUrl" 
                           referrerpolicy="no-referrer"
                           class="w-full h-full object-cover">
                      <div v-else class="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 p-1">
                         <span class="text-xl">{{ att.type === 'pdf' ? '📄' : att.type === 'youtube' ? '🎬' : '🔗' }}</span>
                         <p class="text-[8px] text-gray-400 truncate w-full text-center mt-1">{{ att.name }}</p>
                      </div>
                      <button @click="removePendingAttachment(idx)" 
                              class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center shadow-lg transition-transform hover:scale-110 z-10">×</button>
                    </div>
                  </div>

                  <div class="flex justify-between items-center mt-3">
                    <div class="flex gap-2">
                      <input ref="fileInput" type="file" accept="image/*,application/pdf,video/*" class="hidden" @change="handleFileSelect">
                      <button @click="fileInput?.click()" :disabled="cloudinaryUploading" class="p-2 hover:bg-gray-100 rounded-lg text-gray-500 disabled:opacity-50 transition-colors flex items-center gap-1" title="上傳圖片或檔案">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                      </button>
                      <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="handleFileSelect">
                      <button @click="cameraInput?.click()" class="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" title="拍照上傳">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                      </button>
                      <button @click="isPoll = !isPoll" 
                              class="p-2 rounded-lg transition-all border"
                              :class="isPoll ? 'bg-emerald-100 text-emerald-700 border-emerald-200 shadow-sm' : 'hover:bg-gray-100 text-gray-500 border-transparent'"
                              title="發起投票">
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="8" x2="16" y2="8"/></svg>
                      </button>
                    </div>
                    <div class="flex gap-2">
                      <button @click="activeSection = null; pendingAttachments = []" class="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">取消</button>
                      <button @click="submitPost(section.id)" class="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg font-bold shadow-md transition-all">發佈</button>
                    </div>
                  </div>
                </div>

                <draggable
                  v-model="localPostsBySection[section.id]"
                  group="posts"
                  item-key="id"
                  class="flex flex-col gap-4 min-h-[50px] pb-4"
                  :disabled="currentSort !== 'manual' || !isOwner"
                  handle=".post-drag-handle"
                  :delay="300"
                  :delay-on-touch-only="true"
                  :touch-start-threshold="15"
                  :force-fallback="true"
                  :fallback-tolerance="15"
                  :animation="150"
                  :scroll-sensitivity="100"
                   ghost-class="opacity-50"
                  @start="isInternalDragging = true"
                  @end="isInternalDragging = false"
                  @change="(evt: any) => {
                    if (evt.added || evt.moved) {
                       boardStore.reorderPosts(boardId, section.id, (localPostsBySection[section.id] || []).map((p: Post) => p.id));
                    }
                  }"
                >
                  <template #item="{ element: post }">
                    <div class="ahmo-post-card rounded-[2rem] p-5 shadow-lg border border-white/5 hover:shadow-2xl hover:border-white/10 transition-all duration-500 group relative h-fit hover:-translate-y-1 active:scale-[0.98] outline-none cursor-pointer will-change-transform select-none"
                         :class="{ 'ring-4 ring-emerald-500 ring-inset': dragTargetPostId === post.id }"
                         :style="{ backgroundColor: post.color || 'rgba(255,255,255,0.95)' }"
                         @dragover="handlePostDragOver(post.id, $event)"
                         @dragleave="dragTargetPostId = null"
                         @drop="handlePostDrop(post, $event)"
                         @click="openPostDetail(post)">
                      
                       <!-- Drop Overlay Internal -->
                      <div v-if="dragTargetPostId === post.id" class="absolute inset-0 bg-emerald-500/20 backdrop-blur-[2px] z-20 flex items-center justify-center rounded-xl pointer-events-none">
                        <span class="text-white font-bold bg-emerald-600 px-3 py-1 rounded-full text-xs">放開以上傳附件</span>
                      </div>


                      <!-- Moderation Badge -->
                      <div v-if="post.status === 'pending'" 
                           class="absolute top-0 left-0 px-3 py-1 bg-amber-500 text-white text-[10px] font-bold rounded-br-xl rounded-tl-xl shadow-sm z-20 pointer-events-none flex items-center gap-1.5 uppercase tracking-wider">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="animate-spin-slow"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        待審核
                      </div>

                       <!-- Post Header (Invisible Drag Area) -->
                        <div class="flex justify-between items-start mb-3 post-drag-handle cursor-move select-none p-1 -m-1 rounded-xl hover:bg-black/5 transition-all" @click.stop>
                         <div class="flex items-center gap-2 pointer-events-none">
                           <img v-if="post.author.photoURL" 
                                :src="post.author.photoURL" 
                                @error="handleImageError(post.author)"
                                referrerpolicy="no-referrer"
                                class="w-8 h-8 rounded-xl border border-white/20 shadow-sm object-cover">
                           <div v-else class="w-8 h-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-xs font-bold text-gray-600">
                             {{ post.author.displayName?.[0] || '?' }}
                           </div>
                           <div>
                             <p class="text-[11px] font-black text-slate-700 flex items-center gap-1 leading-none mb-0.5">
                                {{ post.author.displayName || '訪客' }}
                                <span v-if="post.author.uid === currentBoard?.ownerId" class="bg-amber-100 text-amber-600 p-0.5 rounded" title="看板擁有者">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2 3.5 20h17z"/></svg>
                                </span>
                             </p>
                             <p class="text-[9px] text-slate-400 font-bold uppercase tracking-tighter opacity-70">{{ formatRelativeTime(post.createdAt) }}</p>
                           </div>
                         </div>
                         
                         <!-- Post Actions (Stops Dragging) -->
                         <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto" @mousedown.stop @touchstart.stop @click.stop>
                             <button v-if="isOwner && post.status === 'pending'"
                                     @click="handleApprovePost(post.id)"
                                     class="p-1.5 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-colors" title="核准貼文">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                             </button>
                             <button v-if="post.author.uid === authStore.user?.uid || (authStore.user && isOwner) || (!authStore.user && post.author.displayName === guestName && guestName)" 
                                     @click="handleDelete(post)" 
                                     class="p-1.5 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-all duration-200" title="刪除">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                            </button>
                            <!-- Edit only usually for own post -->
                            <button v-if="post.author.uid === authStore.user?.uid || (authStore.user && isOwner) || (!authStore.user && post.author.displayName === guestName && guestName)"
                                    @click="startEditPost(post)"
                                    class="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-emerald-500 rounded-lg transition-colors" title="編輯">
                               <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg> 
                            </button>
                         </div>
                       </div>

                       <h4 v-if="post.title && editingPostId !== post.id" 
                           class="font-black text-slate-800 mb-2 truncate text-sm tracking-tight leading-tight select-none" 
                           @click="openPostDetail(post)">{{ post.title }}</h4>

                       <!-- Poll Display -->
                       <div v-if="post.poll" class="mb-4 w-full bg-black/5 rounded-xl p-3 border border-black/5">
                          <div class="space-y-2">
                            <div v-for="option in post.poll.options" :key="option.id" class="relative group cursor-pointer" @click.stop="handleVote(post, option.id)">
                               <!-- Progress Bar Background -->
                               <div class="absolute inset-0 bg-white/50 rounded-lg overflow-hidden h-full w-full border border-white/50">
                                  <div class="h-full bg-emerald-400/30 transition-all duration-500 ease-out" 
                                       :style="{ width: post.poll.totalVotes > 0 ? (option.voters.length / post.poll.totalVotes * 100) + '%' : '0%' }"></div>
                               </div>
                               
                               <!-- Content -->
                               <div class="relative flex items-center justify-between p-2 select-none">
                                  <div class="flex items-center gap-2 overflow-hidden">
                                     <!-- Radio Circle -->
                                     <div class="w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                                          :class="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : '')) ? 'border-emerald-600 bg-emerald-600' : 'border-slate-400 bg-white/50 group-hover:border-emerald-500'">
                                         <svg v-if="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))" xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                     </div>
                                     <span class="font-medium text-slate-800 text-xs truncate" :class="{'font-bold text-emerald-800': option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))}">{{ option.text }}</span>
                                  </div>
                                  <span class="text-[10px] font-bold text-slate-500 flex-shrink-0 tabular-nums">
                                    {{ post.poll.totalVotes > 0 ? Math.round(option.voters.length / post.poll.totalVotes * 100) : 0 }}%
                                  </span>
                               </div>
                            </div>
                          </div>
                          <div class="mt-2 flex justify-between items-center text-[10px] text-slate-400 font-medium px-1">
                              <span>{{ post.poll.totalVotes }} 票</span>
                              <!-- <span>{{ post.poll.allowMultiple ? '多選' : '單選' }}</span> -->
                          </div>
                      </div>
                      <!-- Content (Editable) -->
                       <div v-if="editingPostId === post.id" class="mb-3">
                            <input v-model="editPostTitle"
                                   type="text"
                                   placeholder="貼文標題 (選填)..."
                                    class="w-full text-sm text-slate-800 bg-transparent outline-none mb-2 border-b border-gray-200 focus:border-emerald-500 transition-colors placeholder-slate-500"
                                   @keydown.enter.prevent="focusElement(`edit-post-${post.id}`)">
                           
                           <!-- Color Picker for Edit -->
                           <div class="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-hide">
                               <button v-for="color in POST_COLORS" :key="color.value"
                                       @mousedown.prevent="editPostColor = color.value"
                                       @click.stop
                                       class="w-5 h-5 rounded-full border border-gray-200 transition-transform hover:scale-110 flex-shrink-0"
                                       :class="{ 'ring-2 ring-emerald-500 ring-offset-1': editPostColor === color.value }"
                                       :style="{ backgroundColor: color.value }"
                                       :title="color.name">
                               </button>
                           </div>
                           
                           <!-- Poll Editing UI (Shelf/Stream) -->
                           <div v-if="post.poll" class="space-y-2 mb-3 bg-black/5 p-3 rounded-xl border border-black/5 mt-2 overflow-hidden">
                             <div v-for="(option, idx) in editPollOptions" :key="option.id" class="flex items-center gap-2">
                               <span class="text-[10px] font-bold text-slate-400 w-4 flex-shrink-0 text-center">{{ idx + 1 }}.</span>
                               <input v-model="option.text" type="text" class="flex-1 w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 shadow-sm transition-colors" placeholder="選項文字" />
                             </div>
                           </div>
                           
                           <textarea :id="`edit-post-${post.id}`"
                                     v-model="editContent"
                                     :style="{ backgroundColor: editPostColor !== '#ffffff' ? editPostColor : '#f9fafb' }"
                                     @keydown.ctrl.enter="saveEditPost(post)"
                                     @keydown.esc="cancelEditPost"
                                     @click.stop
                                     class="w-full border border-emerald-500 rounded-xl p-3 text-sm text-slate-900 placeholder-slate-500 outline-none resize-none h-28 transition-colors shadow-inner"></textarea>
                            
                            <!-- Edit Mode Media Upload Button (New) -->
                            <div v-if="pendingAttachments.length" class="flex gap-2 mt-2 flex-wrap pb-2 border-b border-gray-100">
                              <div v-for="(att, idx) in pendingAttachments" :key="idx" class="relative w-12 h-12 rounded-lg overflow-hidden border group/p">
                                  <img v-if="att.thumbnailUrl" 
                                       :src="att.type === 'image' ? getViewUrl(att.url) : att.thumbnailUrl" 
                                       referrerpolicy="no-referrer"
                                       class="w-full h-full object-cover">
                                  <div v-else class="flex flex-col items-center justify-center h-full bg-gray-50 p-1">
                                      <svg v-if="att.type === 'pdf'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
                                      <svg v-else-if="att.type === 'youtube'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-600"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
                                      <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                      <p class="text-[7px] text-gray-400 truncate w-full text-center mt-1">{{ att.name }}</p>
                                  </div>
                                  <button @click.stop="removePendingAttachment(idx)" 
                                          class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center shadow-lg transition-transform hover:scale-110 z-10">×</button>
                              </div>
                            </div>

                            <div class="flex justify-between items-center mt-2">
                              <div class="flex gap-1">
                                 <input ref="fileInput" type="file" accept="image/*,application/pdf,video/*" class="hidden" @change="handleFileSelect">
                                 <button @click.stop="fileInput?.click()" :disabled="cloudinaryUploading" class="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" title="上傳附件">
                                   <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                                 </button>
                                 <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="handleFileSelect">
                                 <button @click.stop="cameraInput?.click()" class="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" title="拍照上傳">
                                   <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                                 </button>
                              </div>
                              <div class="flex gap-2">
                                <button @click.stop="cancelEditPost" class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 font-bold border border-gray-200 rounded">取消</button>
                                <button @click.stop="saveEditPost(post)" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded font-bold shadow-sm">儲存</button>
                              </div>
                            </div>
                        </div>
                         <div v-else-if="post.content" class="mb-3 select-none">
                            <div class="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap transition-all overflow-hidden cursor-pointer select-none"
                                 :class="{'line-clamp-6': !expandedPostsInList[post.id] && post.content.length > 350}"
                                 @click="openPostDetail(post)"
                                 v-html="formatContent(post.content)">
                            </div>
                           <button v-if="post.content.length > 350" 
                                   @click.stop="expandedPostsInList[post.id] = !expandedPostsInList[post.id]"
                                   class="text-emerald-600 hover:text-emerald-700 text-[10px] font-black mt-2 uppercase tracking-widest flex items-center gap-1.5 bg-emerald-50 px-2 py-1 rounded-lg transition-colors">
                             {{ expandedPostsInList[post.id] ? '收起貼文' : '... 繼續閱讀' }}
                             <svg v-if="!expandedPostsInList[post.id]" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                             <svg v-else xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                           </button>
                        </div>
                      
                      <!-- Attachments -->
                      <div v-if="post.attachments?.length" class="space-y-2 mb-3">
                        <template v-for="(att, index) in post.attachments" :key="att.url || att.shareUrl || index">
                          <div class="relative group/att">
                            <!-- Image -->
                            <div v-if="att.type === 'image'" class="relative group/preview">
                                 <img :src="getViewUrl(att.url || att.shareUrl!)" 
                                      referrerpolicy="no-referrer"
                                      loading="lazy"
                                       class="w-full h-40 object-cover rounded-lg cursor-pointer hover:brightness-90 transition-all border border-gray-100"
                                      @click.stop="openPreview(att.url!, 'image')">
                                <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity pointer-events-none">
                                    <span class="bg-black/60 text-white px-3 py-1 rounded-full text-[10px] font-bold backdrop-blur-sm flex items-center gap-1.5">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                      放大檢視
                                    </span>
                                </div>
                            </div>
                           
                           <!-- YouTube -->
                           <div v-else-if="att.type === 'youtube'" class="relative aspect-video rounded-lg overflow-hidden shadow-sm pointer-events-auto" @mousedown.stop>
                             <iframe :src="att.shareUrl" class="absolute inset-0 w-full h-full" allowfullscreen frameborder="0"></iframe>
                           </div>
                           
                            <!-- PDF -->
                            <div v-else-if="att.type === 'pdf'" 
                                 class="flex flex-col bg-gradient-to-br from-red-50 to-orange-50 hover:from-red-100 hover:to-orange-100 rounded-lg cursor-pointer transition-all border border-red-200/60 overflow-hidden relative group/preview shadow-sm hover:shadow-md">
                              <!-- PDF Icon Area -->
                              <div class="w-full h-40 flex items-center justify-center bg-gradient-to-br from-red-100/80 to-red-200/50 relative">
                                <div class="flex flex-col items-center gap-2">
                                  <svg class="w-16 h-16 text-red-400 group-hover/preview:text-red-500 transition-colors" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                                    <polyline points="14 2 14 8 20 8" fill="none" stroke="white" stroke-width="1"/>
                                    <text x="12" y="17" text-anchor="middle" font-size="5" font-weight="bold" fill="white">PDF</text>
                                  </svg>
                                  <span class="text-xs text-red-400 font-medium">{{ att.name || 'PDF 文件' }}</span>
                                </div>
                                <!-- Preview Overlay -->
                                <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity bg-black/20 backdrop-blur-[1px]"
                                     @click.stop="openPreview(att.url || att.shareUrl || '', 'pdf')">
                                  <span class="bg-white/90 text-red-600 px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                    點此直接瀏覽
                                  </span>
                                </div>
                              </div>
 
                              <div class="p-3 flex items-center gap-3" @click.stop="openLink(att.url || att.shareUrl, 'pdf')">
                                <div class="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center text-lg shadow-sm flex-shrink-0">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-red-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
                                </div>
                                <div class="overflow-hidden flex-1">
                                  <p class="font-bold text-red-800 text-sm truncate">{{ att.name || 'PDF 文件' }}</p>
                                  <p class="text-xs text-red-500">點擊開啟新分頁</p>
                                </div>
                                <svg class="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                                </svg>
                              </div>
                            </div>
 
                           <!-- Video -->
                           <div v-else-if="att.type === 'video'" class="rounded-lg overflow-hidden shadow-sm bg-black relative">
                             <video :src="att.url || att.shareUrl" 
                                    :poster="att.url ? getVideoThumbnail(att.url) : ''"
                                    controls 
                                    class="w-full max-h-[300px] object-contain pointer-events-auto"
                                    @mousedown.stop>
                             </video>
                           </div>

                           <!-- Audio -->
                           <div v-else-if="att.type === 'audio'" class="rounded-lg overflow-hidden shadow-sm bg-gray-50 p-2 border border-gray-100 pointer-events-auto" @mousedown.stop>
                              <div class="flex items-center gap-2 mb-2 px-1">
                                 <span class="text-lg">🎵</span>
                                 <span class="text-xs font-bold text-gray-600 truncate">{{ att.name || '音訊檔案' }}</span>
                              </div>
                              <audio :src="att.url || att.shareUrl" controls class="w-full h-10"></audio>
                           </div>
 
                           <!-- Link (Fallback) -->
                            <div v-else-if="att.type === 'link'" 
                                class="flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 rounded-lg cursor-pointer transition-colors border border-gray-200 pointer-events-auto"
                                @click.stop="openLink(att.url || att.shareUrl, 'link')"
                                @mousedown.stop>
                             <div class="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center text-xl">🔗</div>
                             <div class="overflow-hidden">
                               <p class="font-bold text-gray-700 text-sm truncate">{{ att.name || '連結' }}</p>
                               <p class="text-xs text-gray-400 truncate">{{ att.url || att.shareUrl }}</p>
                             </div>
                           </div>
                           
                           <!-- Delete Attachment Button -->
                           <button v-if="post.author.uid === authStore.user?.uid"
                                   @click.stop="deleteAttachment(post, Number(index))"
                                   class="absolute top-2 right-2 w-7 h-7 bg-red-500/80 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover/att:opacity-100 transition-all z-10 shadow-lg backdrop-blur-sm"
                                   title="移除附件">
                             ×
                           </button>
                         </div>
                        </template>
                      </div>

                      <!-- Actions -->
                      <div class="flex justify-between items-center py-2 border-t border-gray-100">
                        <button @click.stop="handleLike(post)" 
                                class="flex items-center gap-1.5 text-xs transition-all hover:bg-rose-50 px-2.5 py-1.5 rounded-xl group/like"
                                :class="isLiked(post.id) || likedPosts[post.id] ? 'text-rose-500 font-bold' : 'text-gray-400 hover:text-rose-500'">
                          <span class="transform group-hover/like:scale-125 transition-transform duration-300">
                             <svg v-if="isLiked(post.id) || likedPosts[post.id]" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                             <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                          </span>
                          <span class="tabular-nums">{{ post.likes || 0 }}</span>
                        </button>
                        <button @click.stop="toggleComments(post)" class="flex items-center gap-1.5 text-xs text-gray-400 hover:text-emerald-600 transition-colors px-2.5 py-1.5 rounded-xl hover:bg-emerald-50 pointer-events-auto" @mousedown.stop>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            留言 {{ post.comments?.length ? `(${post.comments.length})` : '' }}
                        </button>
                      </div>

                      <!-- Comments Section -->
                      <div class="mt-3 pt-3 border-t border-gray-100">
                        <div class="space-y-3 mb-3">
                            <div v-for="comment in (expandedComments[post.id] ? post.comments : (post.comments || []).slice(0, 5))" :key="comment.id" class="flex gap-2 text-sm group">
                                <img v-if="comment.author.photoURL" 
                                     :src="comment.author.photoURL" 
                                     @error="handleImageError(comment.author)"
                                     referrerpolicy="no-referrer" 
                                     class="w-6 h-6 rounded-full flex-shrink-0">
                                <div v-else class="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-[10px] flex-shrink-0">
                                    {{ comment.author.displayName.charAt(0) }}
                                </div>
                                <div class="bg-indigo-50/50 backdrop-blur-md border border-white/40 rounded-3xl rounded-tl-none p-3.5 flex-1 relative shadow-sm group-hover:shadow-md transition-all">
                                    <p class="font-black text-[11px] text-indigo-900 mb-1 leading-tight flex justify-between items-center">
                                      {{ comment.author.displayName }}
                                      <span class="text-[9px] text-indigo-400 font-bold opacity-60">剛剛</span>
                                    </p>
                                    <p class="text-slate-800 text-[13px] leading-relaxed font-medium">{{ comment.content }}</p>
                                     <button v-if="comment.author.uid === authStore.user?.uid || isOwner"
                                             @click.stop="handleDeleteComment(post, comment.id)"
                                             class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white border border-red-100 text-red-400 hover:bg-red-500 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-sm flex items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    </button>
                                </div>
                            </div>
                            <button v-if="post.comments?.length > 5" 
                                    @click.stop="toggleExpandComments(post.id)"
                                    class="text-emerald-600 hover:text-emerald-700 text-xs font-medium py-1 w-full text-left">
                                {{ expandedComments[post.id] ? '↑ 收起留言' : `展開其餘 ${post.comments.length - 5} 則留言...` }}
                            </button>
                        </div>
                        <div v-if="canContribute" class="flex items-center gap-3">
                            <div class="flex items-center gap-2 flex-1">
                                 <input v-model="commentInputs[post.id]" 
                                        @keydown.enter="submitComment(post)"
                                        @click.stop
                                        type="text" 
                                        placeholder="寫下留言..." 
                                        class="flex-1 bg-white rounded-full px-4 py-1.5 text-xs text-slate-900 font-black outline-none border border-slate-200 focus:border-emerald-500 transition-all shadow-sm">
                                <button @click.stop="submitComment(post)" class="text-emerald-600 hover:text-emerald-700 font-bold text-xs">發佈</button>
                            </div>
                        </div>
                      </div>
                    </div>
                  </template>
                </draggable>

                </div>
              </div>
            </template>
          </draggable>

        <!-- Add Section Button (Padlet-style Inline) -->
        <div v-if="isOwner" class="flex-shrink-0 w-80 h-full flex flex-col justify-start pt-10">
            <div v-if="isAddingSection" class="bg-white/10 backdrop-blur-md rounded-[2.5rem] p-6 border border-emerald-500/50 shadow-2xl animate-scale-in">
                <input ref="newSectionInput"
                       v-model="newSectionName" 
                       @keydown.enter="confirmCreateSection"
                       @keydown.esc="cancelAddingSection"
                       @blur="confirmCreateSection"
                       placeholder="輸入欄位名稱..." 
                       class="w-full bg-white/10 text-white font-bold px-4 py-3 rounded-xl outline-none border border-white/10 focus:border-emerald-500 transition-all placeholder-white/30"
                       autofocus />
                <div class="flex justify-end gap-2 mt-4">
                  <button @click="cancelAddingSection" class="px-4 py-2 text-xs text-gray-400 hover:text-white font-bold transition-colors">取消</button>
                  <button @click="confirmCreateSection" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-xl font-bold shadow-lg transition-all">建立</button>
                </div>
            </div>
            <button v-else @click="createSection" 
                    class="w-14 h-14 text-white/20 hover:text-white/80 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 bg-white/5 border border-white/5 hover:border-white/20 hover:bg-white/10"
                    title="新增區段">
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
        </div>
      </main>

      <!-- Stream Layout (Vertical Sections) -->
      <main v-else-if="currentBoard?.layout === 'stream' && !showPasswordModal" 
            @drop.prevent="handleDrop" 
            @dragover.prevent="handleDragOver" 
            @dragleave="handleDragLeave"
            class="flex-1 overflow-y-auto p-6">
        <draggable 
           v-model="localSections"
           item-key="id"
           class="max-w-6xl mx-auto space-y-12 pb-24"
           handle=".section-drag-handle"
           :disabled="!isOwner"
           @change="(evt: any) => {
             if (evt.moved) {
               boardStore.reorderSections(boardId, localSections.map(s => s.id));
             }
           }"
        >
          <template #item="{ element: section }">
            <div>
              <!-- Section Header (Editable) -->
              <div class="flex items-center gap-3 mb-6 section-drag-handle cursor-move">
                <input v-if="editingSectionId === section.id"
                       :id="`edit-section-${section.id}`"
                       v-model="editTitle"
                       @blur="saveEditSection(section)"
                       @keydown.enter="saveEditSection(section)"
                       @click.stop
                       class="px-4 py-2 bg-white/10 backdrop-blur-md rounded-xl text-white font-bold text-lg border border-emerald-500 outline-none w-64"
                />
                <h2 v-else @dblclick="startEditSection(section)"
                    class="px-4 py-2 bg-black/60 rounded-xl text-white font-bold text-lg border border-white/10 shadow-sm cursor-pointer hover:bg-black/80 transition-colors max-w-xl line-clamp-2 break-words"
                    :title="section.title">
                  {{ section.title }}
                </h2>
                <div class="flex items-center gap-1 relative">
                    <button @click.stop="activeSection = section.id" 
                            class="w-9 h-9 flex items-center justify-center rounded-xl bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all backdrop-blur-sm border border-white/10"
                            title="新增貼文">
                      +
                    </button>
                    <button @click.stop="toggleSectionMenu(section.id)" 
                            class="w-9 h-9 flex items-center justify-center rounded-xl bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all backdrop-blur-sm border border-white/10"
                            title="更多">
                      ⋮
                    </button>

                    <!-- Section Menu Dropdown -->
                    <div v-if="activeSectionMenuId === section.id" 
                         class="absolute right-0 top-12 w-48 bg-gray-900 rounded-xl shadow-2xl border border-white/10 z-50 overflow-hidden animate-scale-in origin-top-right">
                       <button @click.stop="activeSection = section.id; closeSectionMenu()" class="w-full text-left px-4 py-3 text-sm text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-3">
                         <span>+</span> 新增貼文
                       </button>
                       <div class="h-px bg-white/10 my-1"></div>
                       <button v-if="canEdit" @click.stop="startEditSection(section); closeSectionMenu()" class="w-full text-left px-4 py-3 text-sm text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-3">
                         <span>✏️</span> 重新命名
                       </button>
                       <button v-if="canEdit" @click.stop="handleDeleteSection(section.id); closeSectionMenu()" class="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 flex items-center gap-3">
                         <span>🗑️</span> 刪除區段
                       </button>
                    </div>
                </div>
              </div>

              <!-- Content Layout: Form + Posts -->
              <div class="flex flex-col md:flex-row gap-6 items-start">
                  
                <!-- Inline Post Form (Side Panel) -->
                <div v-if="activeSection === section.id" class="w-full md:w-80 flex-shrink-0 bg-white rounded-[2rem] p-5 shadow-2xl border border-white/20 animate-slide-in-left sticky top-24 z-30">
                     <div class="flex justify-between items-center mb-4">
                        <h3 class="font-bold text-gray-700">新增貼文</h3>
                        <button @click.stop="activeSection = null" class="text-gray-400 hover:text-gray-600">
                           <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                     </div>

                     <!-- Color Picker -->
                     <div class="flex gap-2 mb-3 overflow-x-auto pb-2 scrollbar-hide">
                        <button v-for="color in POST_COLORS" :key="color.value"
                                @mousedown.prevent="newPostColor = color.value"
                                @click.stop
                                class="w-6 h-6 rounded-full border border-gray-200 transition-transform hover:scale-110 flex-shrink-0"
                                :class="{ 'ring-2 ring-emerald-500 ring-offset-1': newPostColor === color.value }"
                                :style="{ backgroundColor: color.value }"
                                :title="color.name">
                        </button>
                     </div>

                     <input v-model="newPostTitle" 
                            type="text" 
                            :placeholder="isPoll ? '投票問題...' : '貼文標題...'" 
                            class="w-full text-sm font-bold text-gray-800 placeholder-gray-400 bg-transparent outline-none mb-3 px-1 border-b border-transparent focus:border-emerald-500 transition-colors"
                            @keydown.enter.prevent="nextTick(() => contentRefs[section.id]?.focus())">
                           
                     <!-- Poll Options Input -->
                     <div v-if="isPoll" class="space-y-2 mb-3 bg-slate-50 p-2 rounded-lg border border-slate-100">
                        <div v-for="(option, idx) in pollOptions" :key="option.id" class="flex items-center gap-2">
                            <span class="text-xs font-bold text-slate-400 w-4 flex-shrink-0 text-center">{{ idx + 1 }}.</span>
                            <input v-model="option.text" type="text" :placeholder="`選項 ${idx + 1}`" class="flex-1 w-full min-w-0 bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-emerald-400 transition-colors" />
                            <button @click.stop="removePollOption(idx)" class="text-slate-300 hover:text-red-400 p-1" :disabled="pollOptions.length <= 2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                        </div>
                        <button @click.stop="addPollOption" class="w-full py-1.5 border border-dashed border-slate-300 rounded text-slate-400 text-xs font-bold hover:bg-white hover:text-emerald-500 hover:border-emerald-300 transition-all flex items-center justify-center gap-1">
                            + 新增選項
                        </button>
                     </div>

                    <textarea v-model="newPostContent" 
                              :ref="(el) => { if(el) contentRefs[section.id] = el as HTMLTextAreaElement }"
                              :style="{ backgroundColor: newPostColor !== '#ffffff' ? newPostColor : '#ffffff' }"
                              placeholder="輸入內容..." 
                              class="w-full bg-gray-50 rounded-xl p-3 text-sm outline-none focus:bg-white border border-gray-200 focus:border-emerald-500 transition-colors resize-none h-32 mb-2"
                              autofocus></textarea>
                    
                    <div v-if="pendingAttachments.length" class="flex gap-2 mb-3 flex-wrap">
                      <div v-for="(att, idx) in pendingAttachments" :key="idx" 
                           class="relative w-12 h-12 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                        <img v-if="att.thumbnailUrl" :src="att.thumbnailUrl" class="w-full h-full object-cover">
                        <span v-else class="absolute inset-0 flex items-center justify-center text-lg">
                          {{ att.type === 'pdf' ? '📄' : '🎬' }}
                        </span>
                        <button @click.stop="pendingAttachments.splice(idx, 1)" 
                                class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center">×</button>
                      </div>
                    </div>

                    <div class="flex justify-between items-center">
                      <div class="flex gap-1">
                        <input ref="fileInput" type="file" accept="image/*,application/pdf,video/*" class="hidden" @change="handleFileSelect">
                        <button @click.stop="fileInput?.click()" :disabled="cloudinaryUploading" class="p-2 hover:bg-gray-100 rounded-lg text-gray-500 flex items-center gap-1 transition-colors" title="上傳附件">
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                        </button>
                        <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="handleFileSelect">
                        <button @click.stop="cameraInput?.click()" class="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" title="拍照上傳">
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                        </button>
                        <button @click.stop="isPoll = !isPoll" 
                                class="p-2 rounded-lg transition-all border"
                                :class="isPoll ? 'bg-emerald-100 text-emerald-700 border-emerald-200 shadow-sm' : 'hover:bg-gray-100 text-gray-500 border-transparent'"
                                title="發起投票">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="8" x2="16" y2="8"/></svg>
                        </button>
                      </div>
                      <button @click.stop="submitPost(section.id)" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg font-bold shadow-md transition-all active:scale-95">
                        發佈貼文
                      </button>
                    </div>
                </div>

                <!-- Posts Grid (Draggable) -->
                <div class="flex-1 min-w-0">
                  <draggable
                    v-model="localPostsBySection[section.id]"
                    group="posts"
                    item-key="id"
                    class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 min-h-[100px] mb-12 items-start"
                    :disabled="currentSort !== 'manual' || !isOwner"
                    :delay="300"
                    :delay-on-touch-only="true"
                    :touch-start-threshold="15"
                    :force-fallback="true"
                    :fallback-tolerance="15"
                    :animation="150"
                    :scroll-sensitivity="100"
                    @start="isInternalDragging = true"
                    @end="isInternalDragging = false"
                    @change="(evt: any) => {
                      if (evt.added || evt.moved) {
                         boardStore.reorderPosts(boardId, section.id, (localPostsBySection[section.id] || []).map(p => p.id));
                      }
                    }"
                  >
                 <template #item="{ element: post }">
                   <div class="ahmo-post-card bg-white/98 rounded-[2.5rem] p-6 shadow-2xl border border-white/20 transition-all duration-500 group relative hover:-translate-y-2 hover:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.3)] cursor-pointer will-change-transform select-none h-fit"
                 :class="{ 'ring-4 ring-emerald-500 ring-inset': dragTargetPostId === post.id }"
                 :style="{ backgroundColor: post.color || '#ffffff' }"
                 @dragover="handlePostDragOver(post.id, $event)"
                 @dragleave="dragTargetPostId = null"
                 @drop="handlePostDrop(post, $event)"
                 @click="openPostDetail(post)">
                    
                    <div v-if="dragTargetPostId === post.id" class="absolute inset-0 bg-emerald-500/20 backdrop-blur-[2px] z-20 flex items-center justify-center rounded-xl pointer-events-none">
                       <span class="text-white font-bold bg-emerald-600 px-3 py-1 rounded-full text-xs">在此載入附件</span>
                    </div>

                      <!-- Moderation Badge -->
                      <div v-if="post.status === 'pending'" 
                           class="absolute top-0 left-0 px-3 py-1 bg-amber-500 text-white text-[10px] font-black rounded-br-2xl rounded-tl-xl shadow-lg z-20 pointer-events-none flex items-center gap-1.5 border-r border-b border-amber-400/30">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="animate-spin-slow"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        待審核
                      </div>
                
                <!-- Post Actions -->
                <div class="absolute top-2.5 right-2.5 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all z-10 translate-y-2 group-hover:translate-y-0 duration-300">
                    <button v-if="isOwner && post.status === 'pending'"
                            @click.stop="handleApprovePost(post.id)"
                            class="w-8 h-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-90 border border-emerald-400/20"
                            title="核准貼文">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    </button>
                    <button v-if="post.author.uid === authStore.user?.uid || (authStore.user && isOwner) || (!authStore.user && post.author.displayName === guestName && guestName)"
                            @click.stop="handleDelete(post)"
                            class="w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-90 border border-red-400/20"
                            title="刪除"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                    <button v-if="post.author.uid === authStore.user?.uid || (authStore.user && isOwner) || (!authStore.user && post.author.displayName === guestName && guestName)"
                            @click.stop="startEditPost(post)"
                            class="w-8 h-8 bg-blue-500 hover:bg-blue-600 text-white rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-90 border border-blue-400/20"
                            title="編輯"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    </button>
                </div>


                <div class="flex items-center gap-2 mb-3">
                   <img v-if="post.author.photoURL" 
                        :src="post.author.photoURL" 
                        @error="handleImageError(post.author)"
                        referrerpolicy="no-referrer" 
                        class="w-8 h-8 rounded-full object-cover">
                  <div v-else class="w-8 h-8 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full flex items-center justify-center text-white text-sm font-bold">
                    {{ post.author.displayName?.charAt(0) || '?' }}
                  </div>
                  <div>
                    <p class="font-black text-sm text-slate-900">{{ post.author.displayName }}</p>
                    <p class="text-[10px] text-slate-500 font-bold">{{ formatRelativeTime(post.createdAt) }}</p>
                  </div>
                </div>

                <h4 v-if="post.title && editingPostId !== post.id" class="font-black text-slate-900 mb-2 truncate text-sm">{{ post.title }}</h4>

                <!-- Poll Display -->
                <div v-if="post.poll" class="mb-4 w-full bg-slate-50/80 rounded-xl p-3 border border-slate-100">
                  <div class="space-y-2">
                    <div v-for="option in post.poll.options" :key="option.id" class="relative group cursor-pointer" @click.stop="handleVote(post, option.id)">
                       <!-- Progress Bar -->
                       <div class="absolute inset-0 bg-white rounded-lg overflow-hidden h-full w-full border border-slate-200">
                          <div class="h-full bg-emerald-100 transition-all duration-500 ease-out" 
                               :style="{ width: post.poll.totalVotes > 0 ? (option.voters.length / post.poll.totalVotes * 100) + '%' : '0%' }"></div>
                       </div>
                       
                       <div class="relative flex items-center justify-between p-2 select-none">
                          <div class="flex items-center gap-2 overflow-hidden">
                             <!-- Indicator -->
                             <div class="w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                                  :class="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : '')) ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 bg-white group-hover:border-emerald-400'">
                                 <svg v-if="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))" xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                             </div>
                             <span class="font-medium text-slate-800 text-xs truncate" :class="{'font-bold text-emerald-700': option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))}">{{ option.text }}</span>
                          </div>
                          <span class="text-[10px] font-bold text-slate-500 flex-shrink-0 tabular-nums">
                            {{ post.poll.totalVotes > 0 ? Math.round(option.voters.length / post.poll.totalVotes * 100) : 0 }}%
                          </span>
                       </div>
                    </div>
                  </div>
                  <div class="mt-2 text-[10px] text-slate-400 font-medium px-1 flex justify-between">
                      <span>{{ post.poll.totalVotes }} 票</span>
                  </div>
                </div>

                <!-- Content (Editable) -->
                <div v-if="editingPostId === post.id" class="mb-3">
                     <input v-model="editPostTitle"
                            type="text"
                             placeholder="貼文標題 (選填)..."
                             class="w-full text-sm text-slate-900 bg-transparent outline-none mb-2 border-b border-gray-200 focus:border-emerald-500 transition-colors placeholder-slate-500 font-bold"
                            @keydown.enter.prevent="focusElement(`edit-post-${post.id}`)">
                   <!-- Color Picker for Edit -->
                   <div class="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-hide">
                      <button v-for="color in POST_COLORS" :key="color.value"
                              @click.stop="editPostColor = color.value"
                              class="w-5 h-5 rounded-full border border-gray-200 transition-transform hover:scale-110 flex-shrink-0"
                              :class="{ 'ring-2 ring-emerald-500 ring-offset-1': editPostColor === color.value }"
                              :style="{ backgroundColor: color.value }"
                              :title="color.name">
                      </button>
                   </div>
                    <textarea :id="`edit-post-${post.id}`"
                            v-model="editContent"
                            :style="{ backgroundColor: editPostColor !== '#ffffff' ? editPostColor : '#f9fafb' }"
                            @keydown.ctrl.enter="saveEditPost(post)"
                            @keydown.esc="cancelEditPost"
                            @click.stop
                            class="w-full border border-emerald-500 rounded p-2 text-sm outline-none resize-none h-24 transition-colors"></textarea>
                    
                    <!-- Edit Media Tool -->
                    <div v-if="pendingAttachments.length" class="flex gap-1 mt-2 mb-1">
                       <div v-for="(att, i) in pendingAttachments" :key="i" class="relative w-10 h-10 border rounded overflow-hidden">
                          <img v-if="att.thumbnailUrl" :src="att.thumbnailUrl" class="w-full h-full object-cover">
                          <span v-else class="absolute inset-0 flex items-center justify-center text-xl">
                            {{ att.type === 'pdf' ? '📄' : '🎬' }}
                          </span>
                          <button @click.stop="pendingAttachments.splice(i, 1)" 
                                  class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center">×</button>
                       </div>
                    </div>
                    <div class="flex justify-between items-center mt-1">
                       <div class="flex gap-1">
                          <input ref="fileInput" type="file" accept="image/*,application/pdf,video/*" class="hidden" @change="handleFileSelect">
                          <button @click.stop="fileInput?.click()" class="w-8 h-8 bg-gray-100 hover:bg-emerald-500 text-gray-400 hover:text-white rounded-lg flex items-center justify-center transition-all active:scale-95 group/upload" title="上傳附件">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    </button>
                          <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="handleFileSelect">
                          <button @click.stop="cameraInput?.click()" class="w-8 h-8 bg-gray-100 hover:bg-emerald-500 text-gray-400 hover:text-white rounded-lg flex items-center justify-center transition-all active:scale-95 group/upload" title="拍照上傳">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                          </button>
                       </div>
                       <div class="flex gap-2">
                         <button @click.stop="cancelEditPost" class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 font-bold border border-gray-200 rounded">取消</button>
                         <button @click.stop="saveEditPost(post)" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded font-bold shadow-sm">儲存</button>
                       </div>
                    </div>
                </div>
                <div v-else-if="post.content" class="mb-3">
                   <div class="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap transition-all overflow-hidden cursor-pointer"
                        :class="{'line-clamp-6': !expandedPostsInList[post.id] && post.content.length > 350}"
                        @click="openPostDetail(post)"
                        v-html="formatContent(post.content)">
                   </div>
                   <button v-if="post.content.length > 350" 
                           @click.stop="expandedPostsInList[post.id] = !expandedPostsInList[post.id]"
                           class="text-emerald-600 hover:text-emerald-700 text-[10px] font-black mt-2 uppercase tracking-widest flex items-center gap-1.5 bg-emerald-50 px-2 py-1 rounded-lg transition-colors">
                     {{ expandedPostsInList[post.id] ? '收起貼文' : '... 繼續閱讀' }}
                     <svg v-if="!expandedPostsInList[post.id]" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                     <svg v-else xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                   </button>
                </div>
                
                <div v-if="post.attachments?.length" class="space-y-2 mb-3">
                  <template v-for="(att, index) in post.attachments" :key="att.url || att.shareUrl || index">
                    <div class="relative group/att">
                      <img v-if="att.type === 'image'" 
                           :src="att.url || att.shareUrl" 
                           class="w-full h-32 object-cover rounded-lg cursor-pointer hover:brightness-90 transition-all border border-gray-100"
                           @click.stop="openPreview(att.url!, 'image')">
                      
                      <div v-else-if="att.type === 'youtube'" class="relative aspect-video rounded-lg overflow-hidden shadow-sm">
                        <iframe :src="att.shareUrl" class="absolute inset-0 w-full h-full" allowfullscreen frameborder="0"></iframe>
                      </div>
                      
                      <div v-else-if="att.type === 'pdf'" 
                           class="flex flex-col bg-gradient-to-br from-red-50 to-orange-50 hover:from-red-100 hover:to-orange-100 rounded-lg cursor-pointer transition-all border border-red-200/60 overflow-hidden shadow-sm hover:shadow-md group/pdf">
                        <!-- PDF Icon Area -->
                        <div class="w-full h-24 flex items-center justify-center bg-gradient-to-br from-red-100/80 to-red-200/50 relative">
                          <svg class="w-10 h-10 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                            <polyline points="14 2 14 8 20 8" fill="none" stroke="white" stroke-width="1"/>
                            <text x="12" y="17" text-anchor="middle" font-size="5" font-weight="bold" fill="white">PDF</text>
                          </svg>
                          <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/pdf:opacity-100 transition-all duration-300 bg-black/40 backdrop-blur-[2px]"
                               @click.stop="openPreview(att.url || att.shareUrl || '', 'pdf')">
                            <span class="bg-white text-gray-900 px-4 py-1.5 rounded-full text-[10px] font-black shadow-xl flex items-center gap-2 transform -translate-y-2 group-hover/pdf:translate-y-0 transition-transform">
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                              預覽檔案
                            </span>
                          </div>
                        </div>
                        <div class="p-2.5 flex items-center gap-3" @click.stop="openLink(att.url || att.shareUrl, 'pdf')">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 flex-shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
                          <span class="text-[11px] font-bold text-red-700 truncate flex-1 uppercase tracking-tight">{{ att.name || 'PDF Document' }}</span>
                        </div>
                      </div>
  
                      <div v-else-if="att.type === 'video'" class="rounded-lg overflow-hidden bg-black shadow-sm relative group">
                          <video :src="att.url || att.shareUrl" 
                                 :poster="att.url ? getVideoThumbnail(att.url) : ''"
                                 controls class="w-full h-32 object-cover"></video>
                      </div>

                      <div v-else-if="att.type === 'audio'" class="rounded-lg overflow-hidden shadow-sm bg-gray-50 p-1.5 border border-gray-100">
                         <div class="flex items-center gap-2 mb-1 px-1">
                            <span class="text-xs truncate font-bold text-gray-500">{{ att.name || '音訊' }}</span>
                         </div>
                         <audio :src="att.url || att.shareUrl" controls class="w-full h-8"></audio>
                      </div>

                      <!-- Delete Attachment Button -->
                      <button v-if="post.author.uid === authStore.user?.uid"
                              @click.stop="deleteAttachment(post, Number(index))"
                              class="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500/90 hover:bg-red-600 text-white rounded-lg flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-all z-10 shadow-xl border border-red-400/20"
                              title="移除附件">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  </template>
                </div>

                <div class="flex justify-between items-center pt-3 border-t border-slate-900/5">
                  <button @click.stop="handleLike(post)" 
                          class="flex items-center gap-1.5 text-xs transition-all hover:bg-rose-500/10 px-3 py-1.5 rounded-xl group/like active:scale-95"
                          :class="isLiked(post.id) || likedPosts[post.id] ? 'text-rose-500 font-black' : 'text-slate-400 hover:text-rose-500'">
                    <span class="transform group-hover/like:scale-125 transition-all block duration-300">
                      <svg v-if="isLiked(post.id) || likedPosts[post.id]" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                      <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                    </span>
                    <span class="tabular-nums font-bold">{{ post.likes || 0 }}</span>
                  </button>
                  <button @click.stop="toggleComments(post)" class="text-slate-400 hover:text-emerald-500 text-[11px] font-black uppercase tracking-tighter transition-all px-3 py-1.5 rounded-xl hover:bg-emerald-500/10 flex items-center gap-2 group/comment active:scale-95">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover/comment:-rotate-12 transition-transform"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      {{ post.comments?.length || 0 }} 留言
                  </button>
                </div>

                <!-- Comments Section -->
                <div class="mt-3 pt-3 border-t border-gray-100">
                    <div class="space-y-3 mb-3">
                        <div v-for="comment in (expandedComments[post.id] ? post.comments : (post.comments || []).slice(0, 5))" :key="comment.id" class="flex gap-2 text-sm group">
                            <img v-if="comment.author.photoURL" :src="comment.author.photoURL" referrerpolicy="no-referrer" class="w-6 h-6 rounded-full flex-shrink-0">
                            <div v-else class="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-[10px] flex-shrink-0">
                                {{ comment.author.displayName.charAt(0) }}
                            </div>
                             <div v-if="comment.status === 'pending'" class="absolute -left-2 -top-2 px-1.5 py-0.5 bg-amber-500 text-white text-[8px] rounded-full scale-75 z-20">
                                待審
                             </div>
                             <div class="flex flex-col flex-1 relative">
                                <p class="font-black text-[11px] text-gray-800 mb-0.5 flex items-center gap-1.5">
                                    {{ comment.author.displayName }}
                                    <span v-if="comment.author.uid === currentBoard?.ownerId" class="p-0.5 bg-amber-100 text-amber-600 rounded-md" title="看板擁有者">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2 3.5 20h17z"/></svg>
                                    </span>
                                </p>
                                <div class="text-gray-600 break-words" v-html="formatContent(comment.content)"></div>
                                <div class="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button v-if="isOwner && comment.status === 'pending'"
                                            @click.stop="handleApproveComment(post.id, comment.id)"
                                            class="text-emerald-500 hover:text-emerald-700 transition-colors" title="核准留言">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                    </button>
                                    <button v-if="comment.author.uid === authStore.user?.uid || isOwner || (!authStore.user && comment.author.displayName === guestName && guestName)"
                                            @click.stop="handleDeleteComment(post, comment.id)"
                                            class="text-gray-400 hover:text-red-500 transition-colors">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                    </button>
                                </div>
                             </div>
                        </div>
                        <button v-if="(post.comments?.length || 0) > 5" 
                                @click.stop="toggleExpandComments(post.id)"
                                class="text-emerald-600 hover:text-emerald-700 text-xs font-medium py-1 w-full text-left">
                            {{ expandedComments[post.id] ? '↑ 收起留言' : `展開其餘 ${(post.comments?.length || 0) - 5} 則留言...` }}
                        </button>
                    </div>
                    <div v-if="canContribute" class="flex items-center gap-2">
                        <input v-model="commentInputs[post.id]" 
                               @keydown.enter="submitComment(post)"
                               @click.stop
                               type="text" 
                               placeholder="寫下留言..." 
                               class="flex-1 bg-gray-100 rounded-full px-3 py-1.5 text-xs text-slate-900 outline-none focus:bg-white border border-transparent focus:border-emerald-500 transition-colors">
                        <button @click.stop="submitComment(post)" class="text-emerald-600 hover:text-emerald-700 font-bold text-xs">發佈</button>
                    </div>
                </div>
              </div>
                </template>
              </draggable>
            </div>
          </div>
        </div>
        </template>
      </draggable>

        <div v-if="isOwner" class="max-w-6xl mx-auto mt-16 pb-32">
          <div v-if="isAddingSection" class="max-w-lg mx-auto bg-white/10 backdrop-blur-md rounded-[2.5rem] p-8 border border-emerald-500/50 shadow-2xl animate-scale-in">
               <h3 class="text-white font-black text-sm uppercase tracking-widest mb-4 opacity-50">建立新區段</h3>
               <input ref="newSectionInput"
                      v-model="newSectionName" 
                      @keydown.enter="confirmCreateSection"
                      @keydown.esc="cancelAddingSection"
                      @blur="confirmCreateSection"
                      placeholder="輸入欄位名稱..." 
                      class="w-full bg-white/10 text-white font-bold px-6 py-4 rounded-2xl outline-none border border-white/10 focus:border-emerald-500 transition-all placeholder-white/30 text-lg"
                      autofocus />
               <div class="flex justify-end gap-3 mt-6">
                 <button @click="cancelAddingSection" class="px-6 py-2.5 text-sm text-gray-400 hover:text-white font-bold transition-colors">取消</button>
                 <button @click="confirmCreateSection" class="px-8 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-xl font-bold shadow-lg transition-all">建立區段</button>
               </div>
          </div>
          <button v-else @click="createSection" 
                  class="w-full h-20 border-2 border-dashed border-white/5 bg-white/5 hover:bg-white/10 rounded-3xl flex items-center justify-center gap-4 text-white/20 hover:text-emerald-400 hover:border-emerald-500/30 hover:scale-[1.01] active:scale-[0.99] transition-all duration-500 text-sm font-black uppercase tracking-[0.2em] group shadow-xl">
            <div class="w-10 h-10 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center group-hover:bg-emerald-500/10 group-hover:rotate-90 transition-all duration-700 shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-white/20 group-hover:text-emerald-400 transition-colors"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            </div>
            新增區段
          </button>
        </div>
      </main>

      <!-- Wall Layout (Masonry) -->
      <main v-else-if="currentBoard?.layout === 'wall' && !showPasswordModal" 
            class="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 scroll-smooth">
        
        <!-- Add Post Form for Wall (New) -->
        <div v-if="activeSection === 'wall' && canContribute" class="max-w-3xl mx-auto mb-12 bg-slate-900/60 backdrop-blur-3xl rounded-[2.5rem] p-8 border border-white/5 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] animate-scale-in">
          <div class="flex items-center gap-4 mb-6">
            <div class="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shadow-inner">
               <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </div>
            <div>
              <h3 class="text-xl font-black text-white tracking-tight">建立新貼文</h3>
              <p class="text-slate-400 text-xs font-bold uppercase tracking-widest opacity-60">分享你的想法、圖片或連結</p>
            </div>
          </div>

          <input v-model="newPostTitle" type="text" :placeholder="isPoll ? '投票問題...' : '輸入標題 (選填)...'" class="w-full bg-white/5 border border-white/5 rounded-2xl px-6 py-4 text-white font-bold mb-4 outline-none focus:border-emerald-500/50 focus:bg-white/10 transition-all placeholder-white/20 shadow-inner">
          
           <!-- Poll Toggle removed from here -->

           <!-- Poll Options (Wall) -->
           <div v-if="isPoll" class="space-y-3 mb-6 bg-black/20 p-5 rounded-2xl border border-white/5 shadow-inner">
              <div v-for="(option, idx) in pollOptions" :key="option.id" class="flex items-center gap-3">
                  <span class="text-sm font-black text-slate-500 w-6 flex-shrink-0 text-center">{{ idx + 1 }}.</span>
                  <input v-model="option.text" type="text" :placeholder="`選項 ${idx + 1}`" class="flex-1 w-full min-w-0 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-all placeholder-white/20 shadow-sm" />
                  <button @click.stop="removePollOption(idx)" class="text-slate-500 hover:text-red-400 p-2 transition-colors" :disabled="pollOptions.length <= 2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
              </div>
              <button @click.stop="addPollOption" class="w-full py-3 border border-dashed border-white/10 rounded-xl text-slate-400 text-sm font-bold hover:bg-white/5 hover:text-emerald-400 hover:border-emerald-500/30 transition-all flex items-center justify-center gap-2 group/add">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover/add:rotate-90 transition-transform"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  新增選項
              </button>
           </div>
          
          <div class="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
            <button v-for="color in POST_COLORS" :key="color.value" @click.stop="newPostColor = color.value"
                    class="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0"
                    :class="newPostColor === color.value ? 'border-white scale-110 shadow-lg' : 'border-transparent'"
                    :style="{ backgroundColor: color.value }"></button>
          </div>

          <textarea v-model="newPostContent" 
                    :style="{ backgroundColor: newPostColor !== '#ffffff' ? newPostColor : 'transparent' }"
                    class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white min-h-[150px] outline-none focus:border-emerald-500 placeholder-white/30"
                    placeholder="寫點什麼嗎？"></textarea>
          
          <!-- Attachments -->
          <div v-if="pendingAttachments.length" class="flex gap-2 mt-4 flex-wrap">
              <div v-for="(att, idx) in pendingAttachments" :key="idx" class="relative w-20 h-20 rounded-xl overflow-hidden border border-white/20 group">
                <img v-if="att.thumbnailUrl" 
                     :src="att.type === 'image' ? getViewUrl(att.url) : att.thumbnailUrl" 
                     referrerpolicy="no-referrer"
                     class="w-full h-full object-cover">
                <div v-else class="absolute inset-0 flex flex-col items-center justify-center bg-white/5 p-4 group/patt">
                   <div class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/40 group-hover/patt:scale-110 transition-transform">
                     <svg v-if="att.type === 'pdf'" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
                     <svg v-else xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 8 6 4-6 4Z"/></svg>
                   </div>
                   <p class="text-[10px] text-white/40 truncate w-full text-center mt-2 font-bold px-2 uppercase tracking-tighter">{{ att.name }}</p>
                </div>
                <button @click.stop="removePendingAttachment(idx)" 
                        class="absolute top-1.5 right-1.5 bg-red-500/90 hover:bg-red-600 text-white rounded-lg w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-xl border border-red-400/20 active:scale-90">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
          </div>

          <div class="flex justify-between items-center mt-6">
            <div class="flex gap-2">
                <input ref="fileInput" type="file" accept="image/*,application/pdf,video/*" class="hidden" @change="handleFileSelect">
                <button @click.stop="fileInput?.click()" class="w-12 h-12 bg-white/5 hover:bg-white/10 rounded-xl flex items-center justify-center text-white transition-all border border-white/5 active:scale-95 group/upload" title="上傳檔案">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover:rotate-12 transition-transform"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                </button>
                <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="handleFileSelect">
                <button @click.stop="cameraInput?.click()" class="w-12 h-12 bg-white/5 hover:bg-white/10 rounded-xl flex items-center justify-center text-white transition-all border border-white/5 active:scale-95 group/upload" title="拍照上傳">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </button>
                <button @click.stop="isPoll = !isPoll" 
                      class="w-12 h-12 rounded-xl flex items-center justify-center transition-all border active:scale-95"
                      :class="isPoll ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.2)]' : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-white'"
                      title="發起投票">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="8" x2="16" y2="8"/></svg>
                </button>
            </div>
            <div class="flex gap-3">
              <button @click.stop="activeSection = null; pendingAttachments = []" class="px-6 py-2 text-white/50 hover:text-white transition-colors">取消</button>
              <button @click.stop="submitPost(localSections[0]?.id || '')" class="px-8 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-lg shadow-emerald-900/20 transition-all">發佈貼文</button>
            </div>
          </div>
        </div>

        <draggable 
          v-model="localWallPosts"
          item-key="id"
          tag="div"
          class="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-6 max-w-7xl mx-auto"
          :disabled="currentSort !== 'manual' || !isOwner"
          @end="handleWallReorder"
        >
          <template #item="{ element: post }">
            <div class="break-inside-avoid mb-6 rounded-[2rem] p-5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:shadow-[0_20px_40px_rgba(0,0,0,0.16)] transition-all duration-500 group relative border border-transparent h-fit hover:-translate-y-1 cursor-pointer will-change-transform"
                 style="content-visibility: auto; contain-intrinsic-size: 100px 300px;"
                 :style="{ backgroundColor: post.color || 'rgba(255,255,255,0.95)' }"
                 :class="{ 'ring-4 ring-emerald-500 ring-inset': dragTargetPostId === post.id }"
                 @dragover="handlePostDragOver(post.id, $event)"
                 @dragleave="dragTargetPostId = null"
                 @drop="handlePostDrop(post, $event)"
                 @click="openPostDetail(post)">
              
              <div v-if="dragTargetPostId === post.id" class="absolute inset-0 bg-emerald-500/20 backdrop-blur-[2px] z-20 flex items-center justify-center rounded-xl pointer-events-none">
                  <span class="text-white font-bold bg-emerald-600 px-3 py-1 rounded-full text-xs">夾帶檔案至此</span>
              </div>
              
              <!-- Moderation Badge -->
              <div v-if="post.status === 'pending'" 
                   class="absolute top-0 left-0 px-3 py-1.5 bg-amber-500 text-white text-[9px] font-black rounded-br-2xl rounded-tl-xl shadow-lg z-20 pointer-events-none flex items-center gap-1.5 tracking-widest uppercase">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="animate-spin-slow"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                待核准
              </div>
              
              <!-- Post Actions -->
              <div class="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all z-10 translate-y-1 group-hover:translate-y-0">
                  <button v-if="isOwner && post.status === 'pending'"
                          @click.stop="handleApprovePost(post.id)"
                          class="w-8 h-8 bg-emerald-500/90 hover:bg-emerald-600 text-white rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-90 border border-emerald-400/20"
                          title="核准貼文">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </button>
                  <button v-if="post.author.uid === authStore.user?.uid || (authStore.user && isOwner) || (!authStore.user && post.author.displayName === guestName && guestName)"
                          @click.stop="handleDelete(post)"
                          class="w-8 h-8 bg-black/20 hover:bg-red-500 text-white rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-95 border border-white/10"
                          title="刪除">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                  </button>
                  <button v-if="post.author.uid === authStore.user?.uid || (authStore.user && isOwner) || (!authStore.user && post.author.displayName === guestName && guestName)"
                          @click.stop="startEditPost(post)"
                          class="w-8 h-8 bg-black/20 hover:bg-emerald-500 text-white rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-95 border border-white/10"
                          title="編輯">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                  </button>
              </div>

              <!-- Author -->
              <div class="flex items-center gap-2 mb-3">
                <img v-if="post.author.photoURL" 
                     :src="post.author.photoURL" 
                     @error="handleImageError(post.author)"
                     referrerpolicy="no-referrer" 
                     class="w-8 h-8 rounded-full object-cover">
                <div v-else class="w-8 h-8 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {{ post.author.displayName?.charAt(0) || '?' }}
                </div>
                <div>
                  <p class="font-black text-sm text-gray-800 flex items-center gap-1.5">
                      {{ post.author.displayName }}
                      <span v-if="post.author.uid === currentBoard?.ownerId" class="p-0.5 bg-amber-100 text-amber-600 rounded-md" title="看板擁有者">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2 3.5 20h17z"/></svg>
                      </span>
                  </p>
                  <p class="text-[10px] text-gray-400">{{ formatRelativeTime(post.createdAt) }}</p>
                </div>
              </div>

              <!-- Post Title -->
              <h4 v-if="post.title && editingPostId !== post.id" class="font-bold text-gray-800 mb-2 truncate" @click="openPostDetail(post)">{{ post.title }}</h4>

              <!-- Poll Display (Wall) -->
               <div v-if="post.poll" class="mb-4 w-full bg-slate-50/80 rounded-xl p-3 border border-slate-100">
                  <div class="space-y-2">
                    <div v-for="option in post.poll.options" :key="option.id" class="relative group cursor-pointer" @click.stop="handleVote(post, option.id)">
                       <!-- Progress Bar -->
                       <div class="absolute inset-0 bg-white rounded-lg overflow-hidden h-full w-full border border-slate-200">
                          <div class="h-full bg-emerald-100 transition-all duration-500 ease-out" 
                               :style="{ width: post.poll.totalVotes > 0 ? (option.voters.length / post.poll.totalVotes * 100) + '%' : '0%' }"></div>
                       </div>
                       
                       <div class="relative flex items-center justify-between p-2 select-none">
                          <div class="flex items-center gap-2 overflow-hidden">
                             <!-- Indicator -->
                             <div class="w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                                  :class="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : '')) ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 bg-white group-hover:border-emerald-400'">
                                 <svg v-if="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))" xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                             </div>
                             <span class="font-medium text-slate-800 text-xs truncate" :class="{'font-bold text-emerald-700': option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))}">{{ option.text }}</span>
                          </div>
                          <span class="text-[10px] font-bold text-slate-500 flex-shrink-0 tabular-nums">
                            {{ post.poll.totalVotes > 0 ? Math.round(option.voters.length / post.poll.totalVotes * 100) : 0 }}%
                          </span>
                       </div>
                    </div>
                  </div>
                  <div class="mt-2 text-[10px] text-slate-400 font-medium px-1 flex justify-between">
                      <span>{{ post.poll.totalVotes }} 票</span>
                  </div>
              </div>

              <!-- Content (Editable) -->
              <div v-if="editingPostId === post.id" class="mb-3">
                   <!-- Post Title for Edit -->
                   <input v-model="editPostTitle"
                          type="text"
                          placeholder="貼文標題 (選填)..."
                          class="w-full text-sm text-gray-800 bg-transparent outline-none mb-2 border-b border-gray-200 focus:border-emerald-500 transition-colors"
                          @keydown.enter.prevent="focusElement(`edit-post-${post.id}`)">
                   <!-- Color Picker for Edit -->
                     <div class="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-hide">
                        <button v-for="color in POST_COLORS" :key="color.value"
                                @mousedown.prevent="editPostColor = color.value"
                                @click.stop
                                class="w-5 h-5 rounded-full border border-gray-200 transition-transform hover:scale-110 flex-shrink-0"
                                :class="{ 'ring-2 ring-emerald-500 ring-offset-1': editPostColor === color.value }"
                                :style="{ backgroundColor: color.value }"
                                :title="color.name">
                        </button>
                     </div>
                    <!-- Poll Editing UI (Wall) -->
                    <div v-if="post.poll" class="space-y-2 mb-4 bg-black/20 p-4 rounded-xl border border-white/5 mt-2 overflow-hidden">
                      <div v-for="(option, idx) in editPollOptions" :key="option.id" class="flex items-center gap-3">
                        <span class="text-xs font-black text-white/30 w-4 flex-shrink-0 text-center">{{ idx + 1 }}.</span>
                        <input v-model="option.text" type="text" class="flex-1 w-full min-w-0 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-emerald-500/50 shadow-sm transition-colors" />
                      </div>
                    </div>

                  <textarea :id="`edit-post-${post.id}`"
                          v-model="editContent"
                           :style="{ backgroundColor: editPostColor !== '#ffffff' ? editPostColor : '#f9fafb' }"
                          @keydown.ctrl.enter="saveEditPost(post)"
                          @keydown.esc="cancelEditPost"
                          @click.stop
                          class="w-full border border-emerald-500 rounded p-2 text-sm outline-none resize-none h-24 transition-colors"></textarea>
                  
                  <!-- Media Tool for Edit -->
                  <div v-if="pendingAttachments.length" class="flex gap-1 mt-2 mb-2 flex-wrap">
                     <div v-for="(att, idx) in pendingAttachments" :key="idx" class="relative w-12 h-12 border rounded overflow-hidden group">
                        <img v-if="att.thumbnailUrl" 
                             :src="att.type === 'image' ? getViewUrl(att.url) : att.thumbnailUrl" 
                             referrerpolicy="no-referrer"
                             class="w-full h-full object-cover">
                        <div v-else class="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 p-1">
                           <span class="text-lg">📄</span>
                           <p class="text-[6px] text-gray-400 truncate w-full text-center">{{ att.name }}</p>
                        </div>
                        <button @click.stop="removePendingAttachment(idx)" 
                                class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center shadow-lg transition-transform hover:scale-110 z-10">×</button>
                     </div>
                  </div>
                  <div class="flex justify-between items-center mt-1">
                     <div class="flex gap-1">
                        <button @click.stop="fileInput?.click()" class="p-1 hover:bg-gray-100 rounded transition-colors text-gray-500" title="上傳附件">
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                        </button>
                        <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="handleFileSelect">
                        <button @click.stop="cameraInput?.click()" class="p-1 hover:bg-gray-100 rounded transition-colors text-gray-500" title="拍照上傳">
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                        </button>
                     </div>
                     <div class="flex gap-2">
                       <button @click.stop="cancelEditPost" class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 font-bold border border-gray-200 rounded">取消</button>
                       <button @click.stop="saveEditPost(post)" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded font-bold shadow-sm">儲存</button>
                     </div>
                  </div>
              </div>
              <div v-else-if="post.content" 
                 @click="openPostDetail(post)"
                 class="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap mb-3 cursor-pointer hover:bg-black/5 rounded p-1 -m-1 transition-colors"
                 title="點擊放大">
                 <div :class="{'line-clamp-6': !expandedPostsInList[post.id] && post.content.length > 350}" v-html="formatContent(post.content)"></div>
                 <button v-if="post.content.length > 350" 
                         @click.stop="expandedPostsInList[post.id] = !expandedPostsInList[post.id]"
                         class="text-emerald-600 hover:text-emerald-700 text-[10px] font-black mt-2 uppercase tracking-widest flex items-center gap-1.5 bg-emerald-50 px-2 py-1 rounded-lg transition-colors">
                   {{ expandedPostsInList[post.id] ? '收起貼文' : '... 繼續閱讀' }}
                   <svg v-if="!expandedPostsInList[post.id]" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                   <svg v-else xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                 </button>
              </div>
              
              <!-- Attachments -->
              <div v-if="post.attachments?.length" class="space-y-2 mb-3">
                <template v-for="(att, index) in post.attachments" :key="att.url || att.shareUrl || index">
                  <div class="relative group/att">
                    <img v-if="att.type === 'image'" 
                         :src="getViewUrl(att.url || att.shareUrl!)" 
                         referrerpolicy="no-referrer"
                         class="w-full rounded-lg cursor-pointer hover:brightness-90 transition-all border border-gray-100"
                         @click="openPreview(att.url!, 'image')">
                    
                    <div v-else-if="att.type === 'youtube'" class="relative aspect-video rounded-lg overflow-hidden shadow-sm">
                      <iframe :src="att.shareUrl" class="absolute inset-0 w-full h-full" allowfullscreen frameborder="0"></iframe>
                    </div>
                    
                    <div v-else-if="att.type === 'pdf'" 
                         class="flex flex-col bg-gradient-to-br from-red-50 to-orange-50 hover:from-red-100 hover:to-orange-100 rounded-lg cursor-pointer transition-all border border-red-200/60 overflow-hidden shadow-sm hover:shadow-md group/pdf">
                      <!-- PDF Icon Area -->
                      <div class="w-full h-24 flex items-center justify-center bg-gradient-to-br from-red-100/80 to-red-200/50 relative">
                        <svg class="w-10 h-10 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                          <polyline points="14 2 14 8 20 8" fill="none" stroke="white" stroke-width="1"/>
                          <text x="12" y="17" text-anchor="middle" font-size="5" font-weight="bold" fill="white">PDF</text>
                        </svg>
                        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/pdf:opacity-100 transition-all duration-300 bg-black/40 backdrop-blur-[2px]"
                             @click.stop="openPreview(att.url || att.shareUrl || '', 'pdf')">
                          <span class="bg-white text-gray-900 px-4 py-1.5 rounded-full text-[10px] font-black shadow-xl flex items-center gap-2 transform -translate-y-2 group-hover/pdf:translate-y-0 transition-transform">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                            預覽檔案
                          </span>
                        </div>
                      </div>
                      <div class="p-2.5 flex items-center gap-3" @click="openLink(att.url || att.shareUrl, 'pdf')">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 flex-shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
                        <span class="text-[11px] font-bold text-red-700 truncate flex-1 uppercase tracking-tight">{{ att.name || 'PDF Document' }}</span>
                      </div>
                    </div>
    
                    <div v-else-if="att.type === 'video'" class="rounded-lg overflow-hidden bg-black shadow-sm">
                        <video :src="att.url || att.shareUrl" 
                               :poster="att.url ? getVideoThumbnail(att.url) : ''"
                               controls class="w-full"></video>
                    </div>

                    <div v-else-if="att.type === 'audio'" class="rounded-lg overflow-hidden shadow-sm bg-gray-50 p-1.5 border border-gray-100">
                       <div class="flex items-center gap-2 mb-1 px-1">
                          <span class="text-xs truncate font-bold text-gray-500">{{ att.name || '音訊' }}</span>
                       </div>
                       <audio :src="att.url || att.shareUrl" controls class="w-full h-8"></audio>
                    </div>

                    <!-- Delete Attachment Button -->
                    <button v-if="post.author.uid === authStore.user?.uid || isOwner"
                            @click.stop="deleteAttachment(post, Number(index))"
                            class="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500/90 hover:bg-red-600 text-white rounded-lg flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-all z-10 shadow-xl border border-red-400/20 active:scale-90"
                            title="移除附件">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                </template>
              </div>

              <!-- Actions -->
              <div class="flex justify-between items-center py-2 border-t border-gray-100">
                <button @click.stop="handleLike(post)" 
                        class="flex items-center gap-1.5 text-xs transition-all hover:bg-rose-50 px-2.5 py-1.5 rounded-xl group/like"
                        :class="isLiked(post.id) || likedPosts[post.id] ? 'text-rose-500 font-bold' : 'text-gray-400 hover:text-rose-500'">
                  <span class="transform group-hover/like:scale-125 transition-transform duration-300">
                     <svg v-if="isLiked(post.id) || likedPosts[post.id]" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                     <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                  </span>
                  <span class="tabular-nums">{{ post.likes || 0 }}</span>
                </button>
                <button @click="toggleComments(post)" class="flex items-center gap-1.5 text-xs text-gray-400 hover:text-emerald-600 transition-colors px-2.5 py-1.5 rounded-xl hover:bg-emerald-50">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    留言 {{ post.comments?.length ? `(${post.comments.length})` : '' }}
                </button>
              </div>

              <!-- Comments Section -->
              <div class="mt-3 pt-3 border-t border-gray-100">
                  <div class="space-y-3 mb-3">
                      <div v-for="comment in (expandedComments[post.id] ? post.comments : (post.comments || []).slice(0, 5))" :key="comment.id" class="flex gap-2 text-sm group">
                          <img v-if="comment.author.photoURL" :src="comment.author.photoURL" referrerpolicy="no-referrer" class="w-6 h-6 rounded-full flex-shrink-0">
                          <div v-else class="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-[10px] flex-shrink-0">
                              {{ comment.author.displayName.charAt(0) }}
                          </div>
                          <div class="bg-white/40 backdrop-blur-md border border-white/20 rounded-2xl rounded-tl-none p-3 flex-1 relative shadow-sm">
                              <p class="font-black text-xs text-slate-900 mb-1 leading-tight">
                                  {{ comment.author.displayName }}
                              </p>
                              <div class="text-slate-800 text-[13px] leading-relaxed break-words" v-html="formatContent(comment.content)"></div>
                              <button v-if="comment.author.uid === authStore.user?.uid || isOwner"
                                      @click="handleDeleteComment(post, comment.id)"
                                      class="absolute top-1 right-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                              </button>
                          </div>
                      </div>
                  </div>
                  <div v-if="canContribute" class="flex items-center gap-2">
                      <input v-model="commentInputs[post.id]" 
                             @keydown.enter="submitComment(post)"
                             type="text" 
                             placeholder="寫下留言..." 
                             class="flex-1 bg-gray-100 rounded-full px-3 py-1.5 text-xs text-slate-900 outline-none focus:bg-white border border-transparent focus:border-emerald-500 transition-colors">
                      <button @click="submitComment(post)" class="text-emerald-600 hover:text-emerald-700 font-bold text-xs">發佈</button>
                  </div>
              </div>
            </div>
          </template>
        </draggable>

        <!-- Floating Add Button (Wall Mode) -->
        <button v-if="canContribute" @click="activeSection = (activeSection === 'wall' ? null : 'wall')" 
                class="fixed bottom-10 right-10 w-16 h-16 bg-emerald-600 hover:bg-emerald-700 text-white rounded-[1.5rem] shadow-2xl flex items-center justify-center transition-all hover:scale-110 z-30 ring-4 ring-white/10 active:scale-90 group">
          <svg v-if="activeSection === 'wall'" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="group-hover:rotate-90 transition-transform"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </main>
    </template>

    <!-- Settings Modal -->
    <div v-if="showSettingsModal" 
         class="fixed inset-0 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center z-[100] p-4 animate-fade-in"
         @click.self="showSettingsModal = false">
      <div class="bg-slate-900 border border-white/10 rounded-[3rem] p-10 w-full max-w-4xl shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] max-h-[90vh] overflow-y-auto animate-scale-in scrollbar-hide">
        <h2 class="text-3xl font-black text-white mb-10 flex items-center gap-4 tracking-tighter">
          <span class="w-10 h-10 bg-emerald-500/10 text-emerald-500 rounded-xl flex items-center justify-center border border-emerald-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          </span> 
          看板設定中心
        </h2>
        
        <div class="flex flex-col lg:flex-row gap-8">
          <!-- Left Tabs Sidebar -->
          <div class="lg:w-48 flex-shrink-0">
            <nav class="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 scrollbar-hide">
              <button v-for="tab in SETTINGS_TABS" 
                      :key="tab.id"
                      @click="settingsTab = tab.id"
                      :class="['flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-black transition-all whitespace-nowrap border border-transparent', 
                               settingsTab === tab.id ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-900/40' : 'text-slate-400 hover:text-white hover:bg-white/5 hover:border-white/5']">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><path :d="tab.icon"/></svg>
                {{ tab.label }}
              </button>
            </nav>
          </div>

          <!-- Right Content Area -->
          <div class="flex-1 space-y-8 text-white min-h-[400px]">
            <!-- Tab: Basic Info -->
            <transition name="fade-slide" mode="out-in">
              <div v-if="settingsTab === 'basic'" :key="'basic'" class="space-y-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div class="space-y-3">
                    <div>
                      <label class="block text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1.5 px-1">看板標題與描述</label>
                      <input v-model="currentBoard!.title" 
                             type="text" 
                             placeholder="輸入看板名稱..."
                             class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-500 focus:bg-white/10 focus:text-white transition-all font-black text-base shadow-inner text-white">
                    </div>
                    <div>
                      <textarea v-model="currentBoard!.description" 
                                rows="2"
                                placeholder="空間簡介 (選填)..."
                                class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-500 focus:bg-white/10 focus:text-white transition-all resize-none text-xs leading-relaxed text-white"></textarea>
                    </div>

                    <div class="pt-2 border-t border-white/5">
                      <label class="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 px-1">訪客互動權限</label>
                      <div class="bg-white/5 p-3 rounded-2xl border border-white/5 space-y-3">
                        <div class="flex items-center justify-between">
                          <span class="text-xs font-bold text-gray-300">寫作權限</span>
                          <div class="flex bg-black/40 p-1 rounded-lg">
                            <button v-for="p in [{id:'edit',l:'可新增'}, {id:'view',l:'唯讀'}]" :key="p.id"
                                    @click="currentBoard!.guestPermission = p.id as any"
                                    :class="['px-3 py-1 rounded-md text-[10px] font-black transition-all', currentBoard!.guestPermission === p.id ? 'bg-emerald-500 text-white shadow-md' : 'text-gray-500 hover:text-white']">
                              {{ p.l }}
                            </button>
                          </div>
                        </div>
                        <div class="flex items-center justify-between cursor-pointer group/mod p-2 rounded-xl border border-white/5 hover:bg-white/5 transition-all" @click="currentBoard!.moderationEnabled = !currentBoard!.moderationEnabled">
                          <div class="flex flex-col gap-1">
                             <div class="flex items-center gap-2">
                               <span class="text-sm font-black text-white">貼文需審核</span>
                               <span :class="['text-[10px] font-bold px-1.5 py-0.5 rounded border', currentBoard!.moderationEnabled ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-600/50']">
                                 {{ currentBoard!.moderationEnabled ? '已啟用' : '已停用' }}
                               </span>
                             </div>
                             <span class="text-[10px] text-gray-400/80 font-medium">開啟後，所有訪客貼文需經過您的批准才會公開顯示。</span>
                          </div>
                          
                          <div :class="['w-12 h-7 flex items-center rounded-full p-1 cursor-pointer transition-all duration-300 shadow-inner border', currentBoard!.moderationEnabled ? 'bg-emerald-500 border-emerald-400' : 'bg-slate-700/50 border-white/10']">
                             <div :class="['bg-white w-5 h-5 rounded-full shadow-lg transform duration-300 ease-in-out', currentBoard!.moderationEnabled ? 'translate-x-5' : 'translate-x-0']"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="space-y-3">
                    <label class="block text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1.5 px-1">隱私安全性</label>
                    <div class="grid gap-1.5">
                      <label v-for="p in [
                        { id: 'public', label: '完全公開 (所有人皆可見)', icon: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z', color: 'text-emerald-400' },
                        { id: 'password', label: '密碼保護 (輸入密碼才可視)', icon: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4', color: 'text-blue-400' },
                        { id: 'private', label: '私密看板 (僅限擁有者)', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', color: 'text-red-400' }
                      ]" :key="p.id" 
                             :class="['flex items-center gap-3 cursor-pointer p-3 rounded-xl border transition-all text-xs font-bold', 
                                       currentBoard!.privacy === p.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/5 bg-white/5 hover:border-white/10']">
                        <input type="radio" v-model="currentBoard!.privacy" :value="p.id" class="sr-only">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" :class="p.color"><path :d="p.icon"/></svg>
                        <span>{{ p.label }}</span>
                      </label>
                    </div>
                    <div v-if="currentBoard!.privacy === 'password'" class="animate-scale-in">
                      <input v-model="currentBoard!.password" 
                             type="password" 
                             placeholder="請輸入存取密碼..." 
                             class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 font-mono tracking-widest">
                    </div>
                    
                    <button @click="deleteBoard" class="mt-4 w-full flex items-center justify-between p-3 rounded-2xl border border-red-500/10 bg-red-500/5 hover:bg-red-500/10 transition-all group">
                        <div class="flex items-center gap-3">
                          <div class="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                          </div>
                          <span class="text-[11px] font-black text-red-500 uppercase tracking-wider">危險區域：刪除此看板</span>
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                  </div>
                </div>
              </div>

              <div v-else-if="settingsTab === 'visual'" :key="'visual'" class="space-y-8">
                <!-- Layout -->
                <div>
                  <label class="block text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-4 px-1">版型排版</label>
                  <div class="grid grid-cols-3 gap-3">
                    <div v-for="layout in [
                      { id: 'shelf', label: '書架', icon: 'M3 3h8v18H3zM13 3h8v18h-8zM3 9h8M13 9h8' },
                      { id: 'wall', label: '牆面', icon: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18' },
                      { id: 'stream', label: '串流', icon: 'M3 6h18M3 12h18M3 18h18' }
                    ]" :key="layout.id"
                         @click="currentBoard!.layout = layout.id as any"
                         :class="['p-3 rounded-2xl border-2 text-center cursor-pointer transition-all flex flex-col items-center gap-2 group', 
                                   currentBoard?.layout === layout.id ? 'border-emerald-500 bg-emerald-500/10 text-white shadow-lg' : 'border-white/5 text-gray-500 hover:border-white/20 hover:bg-white/5']">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="group-hover:scale-110 transition-transform"><path :d="layout.icon"/></svg>
                      <span class="text-[10px] font-black tracking-tight">{{ layout.label }}</span>
                    </div>
                  </div>
                </div>

                <!-- Background -->
                <div>
                  <div class="flex items-center justify-between mb-4 px-1">
                    <label class="text-[10px] font-black text-emerald-400 uppercase tracking-widest">視覺背景</label>
                    <div class="flex gap-2">
                       <input ref="backgroundFileInput" type="file" accept="image/*" class="hidden" @change="handleBackgroundUpload">
                       <button @click="backgroundFileInput?.click()" class="text-[9px] font-black bg-white/5 hover:bg-white/10 px-3 py-1 rounded-full border border-white/10 transition-all text-white/50 hover:text-white">本地上傳</button>
                    </div>
                  </div>
                  
                  <div class="space-y-4">
                    <!-- Unsplash Search -->
                    <div class="bg-white/5 p-4 rounded-3xl border border-white/5">
                      <div class="flex gap-2 mb-4">
                         <input v-model="unsplashSearchQuery" 
                                @keydown.enter="searchUnsplash"
                                type="text" 
                                placeholder="搜尋 Unsplash 背景..." 
                                class="flex-1 bg-slate-950/50 border border-white/5 rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-emerald-500 transition-all placeholder-white/20">
                          <button @click="searchUnsplash" :disabled="isSearchingUnsplash" class="px-3 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-500 hover:text-white rounded-xl text-xs font-black transition-all border border-emerald-500/30">
                            搜尋
                          </button>
                      </div>

                      <div v-if="unsplashResults.length || customBackgrounds.length" class="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1 scrollbar-hide">
                        <!-- Custom Backgrounds -->
                        <div v-for="bg in customBackgrounds" :key="'cb-'+bg.id" 
                             @click="currentBoard!.backgroundImage = bg.url"
                             :class="['aspect-video rounded-lg bg-cover bg-center cursor-pointer border-2 transition-all relative group', currentBoard?.backgroundImage === bg.url ? 'border-emerald-500 scale-95' : 'border-white/5 hover:border-white/30']"
                             :style="{ backgroundImage: `url(${bg.url})` }">
                             <button @click.stop="handleDeleteBackground(bg.id, bg.publicId, bg.resourceType)" class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-xl z-20">
                               <span class="text-[10px]">×</span>
                             </button>
                        </div>
                        <!-- Unsplash -->
                        <div v-for="(img, idx) in unsplashResults" :key="'un-'+idx" 
                             @click="selectUnsplashImage(img)"
                             :class="['aspect-video rounded-lg bg-cover bg-center cursor-pointer border-2 transition-all hover:opacity-80', currentBoard?.backgroundImage === img ? 'border-emerald-500 scale-95' : 'border-transparent']"
                             :style="{ backgroundImage: `url(${img})` }">
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </transition>
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-8 pt-4 border-t border-white/10">
          <button @click="showSettingsModal = false" class="px-5 py-2.5 text-gray-400 hover:text-white transition-colors">取消</button>
          <button @click="saveBoardSettings" class="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors shadow-lg shadow-emerald-900/20">
            儲存變更
          </button>
        </div>
      </div>
    </div>

    <!-- Share Modal -->
    <div v-if="showShareModal" 
         class="fixed inset-0 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center z-[150] p-4"
         @click.self="showShareModal = false">
      <div class="bg-slate-900 border border-white/10 rounded-[3rem] p-10 w-full max-w-sm shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] animate-scale-in relative overflow-hidden">
        <button @click="showShareModal = false" class="absolute top-8 right-8 text-slate-400 hover:text-white transition-all w-10 h-10 flex items-center justify-center rounded-2xl hover:bg-white/5 border border-transparent hover:border-white/10">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        
        <div class="text-center">
          <h2 class="text-2xl font-black text-white mb-2 tracking-tight">分享看板</h2>
          <p class="text-sm text-slate-400 font-medium mb-8">邀請他人一起協作或瀏覽此空間</p>
          
          <div class="bg-white p-6 rounded-[2rem] shadow-xl inline-block mb-8 relative group border border-slate-800">
            <qrcode-vue :value="generateShareLink()" :size="200" level="H" class="mx-auto" />
            <div class="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-500 bg-emerald-500/90 backdrop-blur-sm rounded-[2rem]">
               <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="mb-2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
               <span class="text-xs font-black text-white uppercase tracking-widest">掃描存取</span>
            </div>
          </div>
 
          <div class="flex items-center gap-2 bg-white/5 border border-white/5 rounded-2xl p-2 mb-6">
            <input :value="generateShareLink()" readonly class="bg-transparent text-xs text-slate-300 w-full outline-none px-4 truncate font-medium">
            <button @click="copyLink" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-xs font-black transition-all shadow-lg shadow-emerald-900/40 active:scale-95 whitespace-nowrap">
              {{ isCopyingConfig ? '已複製!' : '複製連結' }}
            </button>
          </div>

          <div class="text-[11px] font-bold py-2 px-4 rounded-full bg-gray-50 border border-gray-100 inline-flex items-center gap-2">
            存取權限：
            <span v-if="currentBoard?.privacy === 'public'" class="text-emerald-600 flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
              公開看板
            </span>
            <span v-else class="text-amber-600 flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              有限制存取
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Media Preview Modal -->
    <div v-if="previewUrl" 
         class="fixed inset-0 bg-slate-950/95 backdrop-blur-3xl flex items-center justify-center z-[200] p-4 animate-fade-in"
         @click="previewUrl = null">
      <div class="relative w-full h-full max-w-6xl flex flex-col items-center justify-center animate-scale-in" @click.stop>
        <!-- Close Button (Always visible top right) -->
        <button @click="previewUrl = null" class="absolute top-0 right-0 lg:-top-12 lg:-right-12 w-12 h-12 bg-white/10 hover:bg-red-500 text-white rounded-2xl flex items-center justify-center transition-all z-20 backdrop-blur-md border border-white/10 group shadow-2xl">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="group-hover:rotate-90 transition-transform"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        
        <!-- Action Bar (Floating Bottom) -->
        <div class="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-2xl px-6 py-3 rounded-[2rem] text-white text-xs font-black tracking-widest uppercase flex items-center gap-6 z-30 border border-white/20 shadow-2xl animate-slide-up">
            <button @click="openLink(previewOriginalUrl || previewUrl || '', previewType === 'pdf' ? 'pdf' : 'link')" class="hover:text-emerald-400 flex items-center gap-2 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              新分頁開啟
            </button>
            <div class="w-px h-4 bg-white/10"></div>
            <button @click="previewUrl = null" class="hover:text-red-400 flex items-center gap-2 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              關閉預覽
            </button>
        </div>
        
        <!-- PDF Viewer -->
        <div v-if="previewType === 'pdf'" class="w-full h-full rounded-[2.5rem] overflow-hidden bg-white shadow-2xl border border-white/20">
          <iframe :src="previewUrl" 
                  class="w-full h-full border-0" 
                  allow="fullscreen"
                  title="PDF 預覽"></iframe>
        </div>

        <!-- Image Viewer -->
        <img v-else-if="previewType === 'image'" 
             :src="previewUrl" 
             class="max-w-full max-h-full object-contain rounded-xl shadow-2xl">

        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-full text-white text-xs flex gap-4">
            <button @click="openLink(previewOriginalUrl || previewUrl || '', previewType === 'pdf' ? 'pdf' : 'link')" class="hover:text-emerald-400">🔗 分頁開啟</button>
            <span class="opacity-30">|</span>
            <button @click="previewUrl = null" class="hover:text-red-400">🚪 關閉</button>
        </div>
      </div>
    </div>
    <!-- Section Title Modal -->
    <!-- Section Prompt Modal Removed -->

    <!-- YouTube Link Modal -->
    <div v-if="showYouTubeInput" 
         class="fixed inset-0 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center z-[250] p-4 animate-fade-in"
         @click.self="showYouTubeInput = false">
      <div class="bg-slate-900 border border-white/10 rounded-[3rem] p-10 w-full max-w-sm shadow-2xl animate-scale-in text-center">
        <div class="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6 border border-red-500/20 shadow-lg shadow-red-500/10">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
        </div>
        <h3 class="text-2xl font-black text-white mb-2 tracking-tight">插入 YouTube</h3>
        <p class="text-sm text-slate-400 mb-8 font-medium">貼上連結，我們會自動產生精美預覽</p>
        
        <input v-model="youtubeUrlInput" 
               type="text" 
               placeholder="貼上網址或分享連結..." 
               class="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 mb-8 focus:outline-none focus:border-red-500 focus:bg-white/10 transition-all font-black text-center text-sm"
               @keydown.enter="confirmAddYouTube"
               autofocus>
        
        <div class="flex gap-3">
           <button @click="showYouTubeInput = false" class="flex-1 py-3 text-slate-400 hover:text-white font-bold transition-colors">取消</button>
           <button @click="confirmAddYouTube" 
                   :disabled="!youtubeUrlInput.trim()"
                   class="flex-[2] py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black disabled:opacity-50 transition-all shadow-xl shadow-red-900/40 active:scale-95">
             加入影片
           </button>
        </div>
      </div>
    </div>
  </div>

    <!-- Guest Name Modal -->

    <div v-if="showGuestNameModal" 
         class="fixed inset-0 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center z-[250] p-4 animate-fade-in"
         @click.self="showGuestNameModal = false">
      <div class="bg-slate-900 border border-white/10 rounded-[3rem] p-10 w-full max-w-sm shadow-2xl animate-scale-in text-center">
        <div class="w-16 h-16 bg-purple-500/10 text-purple-400 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6 border border-purple-500/20">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <h3 class="text-2xl font-black text-white mb-2 tracking-tight">設定您的暱稱</h3>
        <p class="text-sm text-slate-400 mb-8 font-medium">輸入一個名稱，讓大家認識您吧！</p>
        
        <input v-model="guestNameInput" 
               type="text" 
               placeholder="輸入稱呼 (例：阿墨、小明...)" 
               class="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 mb-8 focus:outline-none focus:border-purple-500 focus:bg-white/10 transition-all font-black text-center text-lg"
               @keydown.enter="saveGuestName"
               autofocus>
        
        <div class="flex gap-3">
           <button @click="showGuestNameModal = false" class="flex-1 py-3 text-slate-400 hover:text-white font-bold transition-colors">取消</button>
           <button @click="saveGuestName" 
                   :disabled="!guestNameInput.trim()"
                   class="flex-[2] py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-2xl font-black disabled:opacity-50 transition-all shadow-xl shadow-purple-900/40 active:scale-95">
             開始體驗
           </button>
        </div>
      </div>
    </div>

    <!-- Post Detail Modal -->
    <div v-if="expandedPost" 
         class="fixed inset-0 bg-slate-950/90 backdrop-blur-2xl flex items-center justify-center z-[190] p-4 lg:p-10 animate-fade-in"
         @click="closePostDetail"
         @keydown.left="navigatePost('prev')"
         @keydown.right="navigatePost('next')"
         @keydown.escape="closePostDetail"
         tabindex="0">
      
      <!-- Navigation Group -->
      <div class="relative flex items-center justify-center w-full max-w-7xl gap-6 h-full pointer-events-none" @click.stop>
        <!-- Navigation Arrows -->
        <button v-if="expandedPostIndex > 0"
                @click.stop="navigatePost('prev')" 
                class="w-16 h-16 bg-white/5 hover:bg-white/10 rounded-3xl flex items-center justify-center text-white z-20 backdrop-blur-xl transition-all hover:scale-110 pointer-events-auto border border-white/10 shadow-2xl group">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="group-hover:-translate-x-1 transition-transform"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div v-else class="w-16 h-16"></div> <!-- Spacer -->
 
        <!-- Post Detail Card -->
        <div v-if="expandedPost" class="bg-white/95 backdrop-blur-3xl rounded-[3rem] shadow-[0_64px_128px_-32px_rgba(0,0,0,0.5)] w-full max-w-2xl max-h-[90vh] overflow-y-auto relative pointer-events-auto border border-white/40 animate-scale-in" 
             @click.stop
             :style="expandedPost.color ? { backgroundColor: expandedPost.color } : {}">
        
        <!-- Close Button -->
        <button @click="closePostDetail" class="absolute top-8 right-8 w-12 h-12 bg-black/5 hover:bg-black/10 rounded-2xl flex items-center justify-center text-gray-600 z-10 transition-all hover:rotate-90 hover:scale-110">
           <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
 
        <!-- Post Counter -->
        <div class="absolute top-8 left-10 bg-black/5 rounded-2xl px-5 py-2 text-[10px] font-black tracking-[0.2em] text-gray-400 uppercase">
          Post {{ expandedPostIndex + 1 }} <span class="mx-1 opacity-30">/</span> {{ allFlatPosts.length }}
        </div>

          <div class="p-8 pt-16">
            <!-- Author -->
            <div class="flex items-center gap-4 mb-8 bg-slate-50/50 p-4 rounded-3xl border border-slate-100/50 shadow-inner">
              <img v-if="expandedPost.author.photoURL" :src="expandedPost.author.photoURL" referrerpolicy="no-referrer" class="w-12 h-12 rounded-2xl object-cover border-2 border-white shadow-sm">
              <div v-else class="w-12 h-12 bg-gradient-to-br from-slate-200 to-slate-400 rounded-2xl flex items-center justify-center text-slate-600 font-black text-xl shadow-sm border-2 border-white">
                {{ expandedPost.author.displayName?.charAt(0) || '?' }}
              </div>
              <div class="flex flex-col">
                <p class="font-black text-slate-800 text-base leading-none mb-1">{{ expandedPost.author.displayName }}</p>
                <p class="text-[10px] text-slate-400 font-black uppercase tracking-widest">{{ expandedPost.createdAt?.toLocaleString ? expandedPost.createdAt.toLocaleString() : '剛剛' }}</p>
              </div>
            </div>
 
            <!-- Content -->
            <p v-if="expandedPost.content" class="text-slate-700 text-lg leading-relaxed whitespace-pre-wrap mb-6 font-medium px-2" v-html="formatContent(expandedPost.content)"></p>
 
             <!-- Poll Display (Expanded) -->
             <div v-if="expandedPost.poll" class="mb-8 w-full bg-slate-50 rounded-[2rem] p-6 border border-slate-100 shadow-inner">
                <div class="space-y-3">
                  <div v-for="option in expandedPost.poll.options" :key="option.id" 
                       class="relative group cursor-pointer active:scale-[0.99] transition-transform" 
                       @click.stop="handleVote(expandedPost!, option.id)">
                     <!-- Progress Bar -->
                     <div class="absolute inset-0 bg-white rounded-2xl overflow-hidden h-full w-full border border-slate-200">
                        <div class="h-full bg-emerald-500/10 transition-all duration-700 ease-out" 
                             :style="{ width: expandedPost.poll.totalVotes > 0 ? (option.voters.length / expandedPost.poll.totalVotes * 100) + '%' : '0%' }"></div>
                     </div>
                     
                     <div class="relative flex items-center justify-between p-4 select-none">
                        <div class="flex items-center gap-3 overflow-hidden">
                           <div class="w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all bg-white"
                                :class="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : '')) ? 'border-emerald-500 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'border-slate-300 group-hover:border-emerald-400'">
                               <svg v-if="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                           </div>
                           <span class="font-bold text-slate-800 text-sm" :class="{'text-emerald-700': option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))}">{{ option.text }}</span>
                        </div>
                        <div class="flex flex-col items-end">
                          <span class="text-sm font-black text-emerald-600 tabular-nums">
                            {{ expandedPost.poll.totalVotes > 0 ? Math.round(option.voters.length / expandedPost.poll.totalVotes * 100) : 0 }}%
                          </span>
                          <span class="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">{{ option.voters.length }} 票</span>
                        </div>
                     </div>
                  </div>
                </div>
                <div class="mt-4 pt-4 border-t border-slate-200/50 flex justify-between items-center px-2">
                    <span class="text-xs font-black text-slate-400 uppercase tracking-widest">{{ expandedPost.poll.totalVotes }} 總票數</span>
                    <span v-if="expandedPost.poll.options.some((opt: any) => opt.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : '')))" 
                          class="text-[10px] font-black text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full uppercase tracking-tighter">
                      已投票
                    </span>
                </div>
             </div>

          <!-- Attachments -->
          <div v-if="expandedPost.attachments?.length" class="space-y-4 mb-6">
            <template v-for="(att, idx) in expandedPost.attachments" :key="idx">
              <div class="relative group/att text-gray-800">
                <!-- Image -->
                <img v-if="att.type === 'image' && (att.url || att.shareUrl)" 
                     :src="att.url || att.shareUrl" 
                     class="w-full rounded-2xl cursor-pointer hover:brightness-95 transition-all shadow-sm border border-gray-100"
                     @click="openPreview(att.url || att.shareUrl || '', 'image')">

                <!-- Video -->
                <div v-else-if="att.type === 'video'" class="rounded-2xl overflow-hidden shadow-sm bg-black">
                    <video :src="att.url || att.shareUrl" 
                           :poster="att.url ? getVideoThumbnail(att.url) : ''"
                           controls class="w-full max-h-[500px]"></video>
                </div>

                <!-- Audio -->
                <div v-else-if="att.type === 'audio'" class="rounded-2xl overflow-hidden shadow-sm bg-gray-50 p-4 border border-gray-100">
                   <div class="flex items-center gap-3 mb-3">
                      <div class="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center text-xl shadow-sm">🎵</div>
                      <div class="flex-1 min-w-0">
                         <p class="font-bold text-gray-700 text-sm truncate">{{ att.name || '音訊檔案' }}</p>
                         <p class="text-xs text-gray-400">點擊播放</p>
                      </div>
                   </div>
                   <audio :src="att.url || att.shareUrl" controls class="w-full h-10"></audio>
                </div>

                <!-- PDF -->
                <div v-else-if="att.type === 'pdf'" 
                     class="flex items-center gap-4 bg-red-50 rounded-2xl p-4 cursor-pointer hover:bg-red-100 transition-all border border-red-100/50"
                     @click="openPreview(att.url || att.shareUrl || '', 'pdf')">
                  <div class="w-14 h-14 bg-red-100 rounded-xl flex items-center justify-center shadow-sm">
                    <svg class="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                      <polyline points="14 2 14 8 20 8" fill="none" stroke="white" stroke-width="1"/>
                      <text x="12" y="17" text-anchor="middle" font-size="5" font-weight="bold" fill="white">PDF</text>
                    </svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="font-bold text-red-800 text-base truncate">{{ att.name || 'PDF 文件' }}</p>
                    <p class="text-red-400 text-sm">點擊內嵌預覽</p>
                  </div>
                </div>

                <!-- YouTube -->
                <div v-else-if="att.type === 'youtube'" class="aspect-video rounded-2xl overflow-hidden shadow-md">
                   <iframe :src="att.shareUrl" class="w-full h-full" frameborder="0" allowfullscreen></iframe>
                </div>

                <!-- Delete Attachment Button -->
                <button v-if="expandedPost.author.uid === authStore.user?.uid"
                        @click.stop="deleteAttachment(expandedPost, Number(idx))"
                        class="absolute top-2 right-2 w-8 h-8 bg-red-600/90 text-white rounded-full flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-all z-10 shadow-lg"
                        title="移除附件">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
              </div>
            </template>
          </div>

          <!-- Actions -->
          <div class="flex justify-between items-center py-4 border-t border-gray-200/50">
            <button @click="handleLike(expandedPost!)" 
                    class="flex items-center gap-2 text-gray-400 hover:text-rose-500 transition-colors group/dlike">
              <span class="transform group-hover/dlike:scale-125 transition-transform duration-300">
                <svg v-if="isLiked(expandedPost!.id) || likedPosts[expandedPost!.id]" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="text-rose-500"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
              </span>
              <span class="font-bold text-sm tabular-nums" :class="{ 'text-rose-500': isLiked(expandedPost!.id) || likedPosts[expandedPost!.id] }">
                {{ expandedPost!.likes || 0 }}
              </span>
            </button>

          </div>

          <!-- Comments Section (always expanded) -->
          <div class="pt-6 border-t border-slate-100 pb-2">
            <h4 class="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              {{ expandedPost!.comments?.length || 0 }} 則留言
            </h4>
            
            <div class="space-y-4 mb-6">
              <div v-for="comment in (expandedComments[expandedPost!.id] ? expandedPost!.comments : (expandedPost!.comments || []).slice(0, 5))" :key="comment.id" class="flex gap-4 text-sm group animate-fade-in">
                <img v-if="comment.author.photoURL" :src="comment.author.photoURL" referrerpolicy="no-referrer" class="w-8 h-8 rounded-xl flex-shrink-0 border-2 border-white shadow-sm">
                <div v-else class="w-8 h-8 bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center text-[10px] font-black text-slate-500 flex-shrink-0">
                  {{ comment.author.displayName.charAt(0) }}
                </div>
                <div class="bg-slate-50/80 rounded-2xl rounded-tl-none p-4 flex-1 relative border border-slate-100/50 hover:bg-slate-100/50 transition-colors">
                  <div class="flex justify-between items-start mb-1">
                    <p class="font-black text-xs text-slate-700 leading-none">{{ comment.author.displayName }}</p>
                    <button v-if="comment.author.uid === authStore.user?.uid || isOwner || (!authStore.user && comment.author.displayName === guestName && guestName)"
                            @click="handleDeleteComment(expandedPost!, comment.id)"
                            class="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1 hover:bg-red-50 rounded-lg">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  <p class="text-slate-600 leading-relaxed font-medium">{{ comment.content }}</p>
                </div>
              </div>
              <button v-if="expandedPost!.comments?.length && expandedPost!.comments.length > 5" 
                      @click="toggleExpandComments(expandedPost!.id)"
                      class="text-emerald-600 hover:text-emerald-700 text-xs font-black py-2 w-full text-center bg-emerald-50/50 rounded-xl border border-emerald-100 hover:bg-emerald-100 transition-all">
                {{ expandedComments[expandedPost!.id] ? '↑ 收起捲動留言' : `展開其餘 ${expandedPost!.comments.length - 5} 則留言...` }}
              </button>
            </div>
 
            <!-- Comment Input -->
            <div class="flex items-center gap-3 bg-slate-50 p-2 rounded-[1.5rem] border border-slate-100 focus-within:border-emerald-500/50 focus-within:bg-white transition-all shadow-inner">
              <input v-model="commentInputs[expandedPost!.id]" 
                     @keydown.enter="submitComment(expandedPost!)"
                     type="text" 
                     placeholder="寫下你的想法..." 
                     class="flex-1 bg-transparent px-4 py-2 text-sm outline-none font-black text-slate-900 placeholder-slate-500">
              <button @click="submitComment(expandedPost!)" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-2xl font-black text-xs shadow-lg shadow-emerald-900/20 active:scale-95 transition-all">發佈</button>
            </div>
          </div>
        </div>
        </div>

        <!-- Next Button -->
        <button v-if="expandedPostIndex < allFlatPosts.length - 1"
                @click.stop="navigatePost('next')" 
                class="w-16 h-16 bg-white/5 hover:bg-white/10 rounded-3xl flex items-center justify-center text-white z-20 backdrop-blur-xl transition-all hover:scale-110 pointer-events-auto border border-white/10 shadow-2xl group">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="group-hover:translate-x-1 transition-transform"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div v-else class="w-16 h-16"></div> <!-- Spacer -->
      </div>
    </div>

    <!-- Password Verification Modal -->
    <Teleport to="body">
      <div v-if="showPasswordModal" 
          class="fixed inset-0 bg-slate-950/95 backdrop-blur-3xl flex items-center justify-center z-[9999] p-4 animate-fade-in"
          data-no-close>
          <div class="bg-slate-900 border border-white/10 rounded-[3rem] p-12 w-full max-w-md shadow-2xl text-center relative z-[10000] animate-scale-in">
              <div class="w-20 h-20 bg-emerald-500/10 text-emerald-500 rounded-3xl flex items-center justify-center text-4xl mx-auto mb-8 border border-emerald-500/20 shadow-xl shadow-emerald-900/10">
                🔒
              </div>
              <h2 class="text-3xl font-black text-white mb-3 tracking-tight">此看板受保護</h2>
              <p class="text-slate-400 text-sm mb-10 font-medium">請輸入看板密碼以繼續存取內容</p>
              
              <form @submit.prevent="submitPassword" class="space-y-6">
                  <input v-model="passwordInput" 
                          type="password" 
                          placeholder="••••••••" 
                          class="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-emerald-500 transition-all text-center text-2xl tracking-[0.5em] font-mono"
                          autofocus>
                  
                  <p v-if="passwordError" class="text-red-400 text-xs font-bold animate-shake">{{ passwordError }}</p>
 
                  <button type="submit" 
                          class="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-emerald-900/40 active:scale-95 disabled:opacity-50"
                          :disabled="!passwordInput">
                      解鎖進入
                  </button>
              </form>
              
              <button @click="$router.push('/')" class="mt-8 text-slate-500 text-xs font-bold hover:text-white transition-colors flex items-center gap-2 mx-auto">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                回首頁
              </button>
          </div>
      </div>
    </Teleport>


    <!-- Slideshow Overlay -->
    <Teleport to="body">
      <div v-if="showSlideshow" class="fixed inset-0 z-[99999] bg-gradient-to-br from-slate-950 via-gray-900 to-slate-900 text-white flex flex-col font-sans">
        <!-- Slideshow Controls (Top Right) -->
        <div class="absolute top-6 right-6 flex items-center gap-3 z-50">
           <button @click="toggleFullscreen" class="p-3 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-all text-white/50 hover:text-white" title="全螢幕">
             <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 1 2-2v-3"/></svg>
           </button>
           <div class="h-6 w-px bg-white/10 mx-1"></div>
           <button @click="togglePlayPause" class="p-3 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-all group text-white/70 hover:text-white" :title="isPlaying ? '暫停' : '播放'">
             <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
             <svg v-else xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M5 3l14 9-14 9V3z"/></svg>
           </button>
           <button @click="closeSlideshow" class="p-3 bg-white/5 hover:bg-red-500/80 rounded-full backdrop-blur-md transition-all text-white/70 hover:text-white" title="關閉">
             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
           </button>
        </div>

        <!-- Slide Content Area -->
        <div class="flex-1 flex items-center justify-center relative overflow-hidden bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDIiLz4KPC9zdmc+')] bg-fixed" @click="nextSlide">
          
          <!-- Background Gradient Ambient -->
          <div class="absolute inset-0 bg-gradient-to-br from-teal-500/10 via-transparent to-purple-500/10 pointer-events-none"></div>
          <div class="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none"></div>
          <div class="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none"></div>

          <Transition name="fade" mode="out-in">
            <!-- Title Slide -->
            <div v-if="currentSlide?.type === 'title'" :key="'title'" class="text-center max-w-5xl mx-auto animate-scale-in relative z-10 px-8">
                <div class="w-24 h-1 bg-gradient-to-r from-emerald-500 to-cyan-500 mx-auto mb-12 rounded-full"></div>
                <h1 class="text-6xl md:text-8xl font-black mb-8 tracking-tighter text-white leading-tight drop-shadow-2xl">{{ currentSlide.data.title }}</h1>
                <p class="text-2xl md:text-3xl text-gray-400 font-light leading-relaxed tracking-wide mb-16">{{ currentSlide.data.description || 'AHMO BOARD PRESENTATION' }}</p>
                <div class="inline-block p-6 bg-white rounded-3xl shadow-[0_0_50px_rgba(255,255,255,0.1)]">
                     <QrcodeVue :value="currentUrl" :size="180" level="H" />
                </div>
                <p class="mt-6 text-xs text-gray-600 font-mono tracking-[0.3em] uppercase">Scan to Join</p>
            </div>

            <!-- Section Slide -->
            <div v-else-if="currentSlide?.type === 'section'" :key="'section-'+currentSlide.data.id" class="text-center animate-scale-in relative z-10 w-full h-full flex flex-col items-center justify-center bg-stone-900">
                <div class="absolute inset-0 opacity-20" :style="{ backgroundColor: currentSlide.data.color || '#10b981' }"></div>
                <h2 class="text-[120px] md:text-[200px] font-black text-white/5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none tracking-widest whitespace-nowrap">SECTION</h2>
                <div class="relative">
                    <div class="inline-block px-4 py-1 border border-white/30 rounded-full text-sm font-bold tracking-[0.2em] text-white/60 mb-8 uppercase backdrop-blur-sm">Chapter</div>
                    <h2 class="text-7xl md:text-9xl font-black text-white tracking-tighter drop-shadow-2xl" :style="{ color: currentSlide.data.color || 'white' }">{{ currentSlide.data.title }}</h2>
                </div>
            </div>

            <!-- Post Slide -->
            <div v-else-if="currentSlide?.type === 'post'" :key="'post-'+currentSlide.data.id" class="w-full h-full flex flex-col md:flex-row animate-fade-in-up">
                
                <!-- Media Side (Left/Top) - 60% Width -->
                <div v-if="currentSlide.data.attachments?.length" class="w-full md:w-[60%] h-[40vh] md:h-full bg-black flex items-center justify-center relative p-8 md:p-12">
                     <!-- Media Background Blur -->
                     <img v-if="currentSlide.data.attachments[0].type === 'image'" :src="getViewUrl(currentSlide.data.attachments[0].url)" class="absolute inset-0 w-full h-full object-cover opacity-30 blur-3xl scale-110" />
                     
                     <div class="relative z-10 w-full h-full flex items-center justify-center shadow-2xl">
                        <img v-if="currentSlide.data.attachments[0].type === 'image'" :src="getViewUrl(currentSlide.data.attachments[0].url)" class="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
                        <iframe v-else-if="currentSlide.data.attachments[0].type === 'youtube'" :src="currentSlide.data.attachments[0].shareUrl" class="w-full aspect-video rounded-xl shadow-2xl" allowfullscreen frameborder="0"></iframe>
                        <video v-else-if="currentSlide.data.attachments[0].type === 'video'" :src="currentSlide.data.attachments[0].url" controls class="max-w-full max-h-full rounded-xl shadow-2xl"></video>
                        <div v-else-if="currentSlide.data.attachments[0].type === 'pdf'" class="w-full h-full bg-white rounded-xl shadow-2xl overflow-hidden">
                            <iframe :src="currentSlide.data.attachments[0].url || currentSlide.data.attachments[0].shareUrl" class="w-full h-full border-0" frameborder="0"></iframe>
                        </div>
                     </div>
                </div>

                <!-- Text Side (Right/Bottom) -->
                 <div :class="['flex flex-col p-12 md:p-20 py-32 md:py-40 h-full overflow-y-auto custom-scrollbar', currentSlide.data.attachments?.length ? 'w-full md:w-[40%] bg-white/5 backdrop-blur-xl border-l border-white/5' : 'w-full max-w-6xl mx-auto bg-transparent items-center text-center']">
                    
                    <div :class="['w-full mx-auto', currentSlide.data.attachments?.length ? 'max-w-2xl' : 'max-w-4xl bg-white/5 backdrop-blur-2xl p-16 rounded-[4rem] border border-white/5 shadow-2xl']">
                        <!-- Author Info -->
                        <div :class="['flex items-center gap-4 mb-8 pb-6 border-b border-white/10', currentSlide.data.attachments?.length ? '' : 'justify-center border-none pb-0 mb-8']">
                            <img v-if="currentSlide.data.author.photoURL" :src="currentSlide.data.author.photoURL" class="w-12 h-12 rounded-full border border-white/10 shadow-lg" />
                            <div v-else class="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-indigo-600 flex items-center justify-center font-bold text-lg shadow-lg">{{ currentSlide.data.author.displayName?.[0] }}</div>
                            <div class="leading-tight text-left">
                                <p class="font-bold text-lg text-white tracking-wide">{{ currentSlide.data.author.displayName }}</p>
                                <p class="text-xs text-white/40 mt-0.5 font-medium tracking-widest uppercase">{{ currentSlide.data.createdAt?.toLocaleString() }}</p>
                            </div>
                        </div>

                        <!-- Title -->
                        <h3 v-if="currentSlide.data.title" class="text-3xl md:text-5xl font-black mb-8 leading-tight text-white tracking-tight drop-shadow-lg">{{ currentSlide.data.title }}</h3>
                        
                        <div :class="['text-xl md:text-2xl text-gray-200 leading-relaxed whitespace-pre-wrap font-light tracking-wide', currentSlide.data.attachments?.length ? 'text-left' : 'text-center text-gray-300']"
                             v-html="formatContent(currentSlide.data.content)">
                        </div>

                        <!-- Poll Results in Slideshow -->
                        <div v-if="currentSlide.data.poll" class="mt-12 space-y-4 w-full max-w-xl" :class="{'mx-auto': !currentSlide.data.attachments?.length}">
                            <div v-for="option in currentSlide.data.poll.options" :key="option.id" class="relative">
                                <div class="h-12 w-full bg-white/5 rounded-2xl overflow-hidden border border-white/5">
                                    <div class="h-full bg-emerald-500/30 transition-all duration-1000"
                                         :style="{ width: currentSlide.data.poll.totalVotes > 0 ? (option.voters.length / currentSlide.data.poll.totalVotes * 100) + '%' : '0%' }"></div>
                                </div>
                                <div class="absolute inset-0 flex items-center justify-between px-6">
                                    <span class="text-lg font-bold text-white">{{ option.text }}</span>
                                    <span class="text-sm font-black text-emerald-400 tabular-nums">
                                        {{ currentSlide.data.poll.totalVotes > 0 ? Math.round(option.voters.length / currentSlide.data.poll.totalVotes * 100) : 0 }}%
                                    </span>
                                </div>
                            </div>
                            <div class="pt-4 text-xs font-black text-white/30 uppercase tracking-[0.2em]">
                                Total: {{ currentSlide.data.poll.totalVotes }} votes
                            </div>
                        </div>
                    </div>
                 </div>
            </div>
          </Transition>
        </div>

        <!-- Progress Bar (Bottom) -->
        <div class="absolute bottom-0 left-0 w-full h-2 bg-white/5 z-50">
          <div class="h-full bg-emerald-500 transition-all duration-300 ease-linear shadow-[0_0_10px_rgba(16,185,129,0.5)]" :style="{ width: `${((currentSlideIndex + 1) / slides.length) * 100}%` }"></div>
        </div>

        <!-- Navigation Buttons (Side Hover Regions) -->
        <button @click.stop="prevSlide" class="absolute left-0 top-0 w-24 h-full z-40 group outline-none hidden md:flex items-center justify-start pl-6 hover:bg-gradient-to-r hover:from-black/50 hover:to-transparent transition-all">
            <div class="p-4 rounded-full bg-white/5 text-white/30 group-hover:text-white group-hover:bg-white/20 group-hover:scale-110 transition-all backdrop-blur-sm opacity-0 group-hover:opacity-100 transform -translate-x-4 group-hover:translate-x-0 duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </div>
        </button>
        <button @click.stop="nextSlide" class="absolute right-0 top-0 w-24 h-full z-40 group outline-none hidden md:flex items-center justify-end pr-6 hover:bg-gradient-to-l hover:from-black/50 hover:to-transparent transition-all">
             <div class="p-4 rounded-full bg-white/5 text-white/30 group-hover:text-white group-hover:bg-white/20 group-hover:scale-110 transition-all backdrop-blur-sm opacity-0 group-hover:opacity-100 transform translate-x-4 group-hover:translate-x-0 duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
        </button>
        
      </div>
    </Teleport>

</template>

<style scoped>
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.05);
}
::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.15);
  border-radius: 10px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,0.25);
}

/* Custom Scrollbar for Slideshow Text Area */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.02);
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.1);
  border-radius: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,0.2);
}


/* Prevent selection during drag to avoid Super Drag interference */
.sortable-drag {
  user-select: none !important;
  -webkit-user-select: none !important;
}

.post-drag-handle {
  user-select: none;
  -webkit-user-select: none;
  cursor: move !important;
}

/* Disable native drag only for specific problematic child elements to allow move handles to work */
.ahmo-post-card img,
.ahmo-post-card a,
.ahmo-post-card video {
  -webkit-user-drag: none !important;
}

.ahmo-post-card h4,
.ahmo-post-card .text-gray-700 {
  user-select: none !important;
  -webkit-user-select: none !important;
}

@keyframes scale-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
.animate-scale-in {
  animation: scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up {
  animation: fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.line-clamp-6 {
  display: -webkit-box;
  -webkit-line-clamp: 6;
  line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* GPU Acceleration for transition stability */
.will-change-transform {
  will-change: transform;
  backface-visibility: hidden;
  transform: translateZ(0);
}

/* Optimize Backdrop Filter Performance */
.backdrop-blur-xl, .backdrop-blur-3xl {
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
}

/* Disable heavy blurs on low-power devices if possible (optional) */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
