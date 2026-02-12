import { ref, reactive } from 'vue';
import { useBoardStore, type Post } from '../stores/board';
import { useAuthStore } from '../stores/auth';
import { useModal } from './useModal';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { DB_PREFIX } from './useAppConfig';

export function usePostActions(boardId: string) {
    const boardStore = useBoardStore();
    const authStore = useAuthStore();
    const modal = useModal();

    const likedPosts = reactive<Record<string, boolean>>({});
    const expandedComments = reactive<Record<string, boolean>>({});
    const commentInputs = reactive<Record<string, string>>({});

    const isLiked = (postId: string) => {
        if (likedPosts[postId]) return true;
        return !!localStorage.getItem(`ahmo_liked_${postId}`);
    };

    const handleLike = async (post: Post) => {
        if (isLiked(post.id)) return;
        try {
            await boardStore.likePost(boardId, post.id, (post.likes || 0) + 1);
            localStorage.setItem(`ahmo_liked_${post.id}`, 'true');
            likedPosts[post.id] = true;
        } catch (err: any) {
            console.error('Like failed:', err);
            if (err.code === 'permission-denied') {
                modal.error('權限不足：訪客可能無法對此看板按讚，請檢查規則設定。');
            }
        }
    };

    const handleApprovePost = async (postId: string) => {
        await boardStore.approvePost(boardId, postId);
        modal.success('貼文已核准');
    };

    const handleBatchApprove = async (pendingCount: number, posts: Post[]) => {
        if (pendingCount === 0) return;
        const confirmed = await modal.confirm(`確定要一次核准所有 ${pendingCount} 則待審貼文嗎？`, '批量核准', 'warning');
        if (!confirmed) return;

        try {
            const pending = posts.filter(p => p.status === 'pending');
            const updates = pending.map(p => updateDoc(doc(db, `${DB_PREFIX}boards`, boardId, 'posts', p.id), { status: 'approved' }));
            await Promise.all(updates);
            modal.success(`已核准 ${pending.length} 則貼文！`);
        } catch (e: any) {
            console.error(e);
            modal.error('核准失敗: ' + e.message);
        }
    };

    const handleDeletePost = async (post: Post, deleteFileCallback?: (publicId: string, token?: string, type?: string) => Promise<void>) => {
        const confirmed = await modal.confirm('確定要刪除這則貼文嗎？', '刪除貼文', 'error');
        if (!confirmed) return;

        if (post.attachments?.length && deleteFileCallback) {
            for (const att of post.attachments) {
                await deleteFileCallback(att.publicId, att.deleteToken, att.resourceType);
            }
        }

        await boardStore.deletePost(boardId, post.id);
        modal.success('貼文已刪除');
    };

    const handleVote = async (post: Post, optionId: string, guestName?: string, requireGuestNameCallback?: (action: () => void) => void) => {
        if (!authStore.user && !guestName) {
            if (requireGuestNameCallback) {
                requireGuestNameCallback(() => handleVote(post, optionId, guestName, requireGuestNameCallback));
            }
            return;
        }

        const userId = authStore.user?.uid || (guestName ? 'guest:' + guestName : 'anonymous');
        try {
            await boardStore.votePoll(boardId, post.id, optionId, userId);
        } catch (err: any) {
            console.error('Voting failed:', err);
            modal.error('投票失敗：' + err.message);
        }
    };

    const handleComment = async (postId: string, content: string, guestName: string, requireGuestNameCallback: (action: () => void) => void) => {
        if (!content?.trim()) return;

        requireGuestNameCallback(async () => {
            await boardStore.addComment(boardId, postId, content, guestName);
            if (commentInputs[postId]) commentInputs[postId] = '';
            expandedComments[postId] = true;
        });
    };

    const handleDeleteComment = async (post: Post, commentId: string) => {
        const confirmed = await modal.confirm('確定要刪除這則留言嗎？', '刪除留言', 'error');
        if (!confirmed) return;
        await boardStore.deleteComment(boardId, post.id, commentId);
    };

    const handleApproveComment = async (post: Post, commentId: string) => {
        await boardStore.approveComment(boardId, post.id, commentId);
        modal.success('留言已核准');
    };

    return {
        likedPosts,
        expandedComments,
        commentInputs,
        isLiked,
        handleLike,
        handleApprovePost,
        handleBatchApprove,
        handleDeletePost,
        handleVote,
        handleComment,
        handleDeleteComment,
        handleApproveComment
    };
}
