<script setup lang="ts">
import { computed } from 'vue';
import type { Post, Board } from '../stores/board';
import { useAuthStore } from '../stores/auth';

const props = defineProps<{
  post: Post;
  currentBoard: Board | null;
  isOwner: boolean;
  guestName: string;
  isLiked: boolean;
  editingPostId: string | null;
  editPostTitle: string;
  editPostColor: string;
  editContent: string;
  editPollOptions: { id: string, text: string }[];
  pendingAttachments: any[];
  expandedComments: boolean;
  expandedPostsInList: boolean;
  layout: 'shelf' | 'stream' | 'wall';
  dragTargetPostId: string | null;
  cloudinaryUploading: boolean;
}>();

const emit = defineEmits([
  'click', 'approve', 'delete', 'edit', 'saveEdit', 'cancelEdit', 
  'like', 'toggleComments', 'submitComment', 'deleteComment', 'approveComment',
  'vote', 'openPreview', 'openLink', 'toggleExpandPost', 'toggleExpandComments',
  'dragover', 'dragleave', 'drop', 'handleFileSelect', 'removePendingAttachment',
  'update:editPostTitle', 'update:editContent', 'update:editPostColor'
]);

const authStore = useAuthStore();

const canEdit = computed(() => {
  const isAuthor = props.post.author.uid === authStore.user?.uid;
  const isGuestAuthor = !authStore.user && props.post.author.displayName === props.guestName && !!props.guestName;
  const isBoardOwner = props.isOwner;
  return isAuthor || isGuestAuthor || isBoardOwner;
});

const formatRelativeTime = (date: Date) => {
  if (!date) return '剛剛';
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 30000) return '剛剛';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`;
  if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString();
};

const formatContent = (text: string) => {
    if (!text) return '';
    const escaped = text
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return escaped.replace(urlRegex, (url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline break-all relative z-20" onclick="event.stopPropagation()">${url}</a>`;
    });
};
</script>

<template>
  <div :class="[
    layout === 'wall' ? 'break-inside-avoid mb-6 rounded-[2rem] p-5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-transparent' : 
    layout === 'stream' ? 'bg-white/98 rounded-[2.5rem] p-6 shadow-2xl border border-white/20' :
    'rounded-[2rem] p-5 shadow-lg border border-white/5',
    'transition-all duration-500 group relative hover:-translate-y-1 hover:shadow-2xl cursor-pointer will-change-transform'
  ]"
  :style="{ backgroundColor: post.color || '#ffffff' }"
  @dragover="emit('dragover', $event)"
  @dragleave="emit('dragleave')"
  @drop="emit('drop', $event)"
  @click="emit('click')">
    
    <div v-if="dragTargetPostId === post.id" class="absolute inset-0 bg-emerald-500/20 backdrop-blur-[2px] z-20 flex items-center justify-center rounded-xl pointer-events-none">
      <span class="text-white font-bold bg-emerald-600 px-3 py-1 rounded-full text-xs">在此載入附件</span>
    </div>

    <!-- Moderation Badge -->
    <div v-if="post.status === 'pending'" 
         class="absolute top-0 left-0 px-3 py-1 bg-amber-500 text-white text-[10px] font-bold rounded-br-xl rounded-tl-xl shadow-sm z-20 pointer-events-none flex items-center gap-1.5 uppercase tracking-wider">
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="animate-spin-slow"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      待審核
    </div>

    <!-- Header / Actions -->
    <div class="flex justify-between items-start mb-3">
      <div class="flex items-center gap-2">
        <img v-if="post.author.photoURL" :src="post.author.photoURL" class="w-8 h-8 rounded-xl border border-white/20 shadow-sm object-cover">
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

      <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button v-if="isOwner && post.status === 'pending'" @click.stop="emit('approve')" class="p-1.5 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>
        <button v-if="canEdit" @click.stop="emit('delete')" class="p-1.5 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-all duration-200"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
        <button v-if="canEdit" @click.stop="emit('edit')" class="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-emerald-500 rounded-lg transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>
      </div>
    </div>

    <!-- Title -->
    <h4 v-if="post.title && editingPostId !== post.id" class="font-black text-slate-800 mb-2 truncate text-sm tracking-tight leading-tight">{{ post.title }}</h4>

    <!-- Poll -->
    <div v-if="post.poll" class="mb-4 w-full bg-black/5 rounded-xl p-3 border border-black/5">
      <div class="space-y-2">
        <div v-for="option in post.poll.options" :key="option.id" class="relative group cursor-pointer" @click.stop="emit('vote', option.id)">
           <div class="absolute inset-0 bg-white/50 rounded-lg overflow-hidden h-full w-full border border-white/50">
              <div class="h-full bg-emerald-400/30 transition-all duration-500 ease-out" 
                   :style="{ width: post.poll.totalVotes > 0 ? (option.voters.length / post.poll.totalVotes * 100) + '%' : '0%' }"></div>
           </div>
           <div class="relative flex items-center justify-between p-2 select-none">
              <div class="flex items-center gap-2 overflow-hidden">
                 <div class="w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                      :class="option.voters.includes(authStore.user?.uid || 'guest:'+guestName) ? 'border-emerald-600 bg-emerald-600' : 'border-slate-400 bg-white/50 group-hover:border-emerald-500'">
                     <svg v-if="option.voters.includes(authStore.user?.uid || 'guest:'+guestName)" xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                 </div>
                 <span class="font-medium text-slate-800 text-xs truncate" :class="{'font-bold text-emerald-800': option.voters.includes(authStore.user?.uid || 'guest:'+guestName)}">{{ option.text }}</span>
              </div>
              <span class="text-[10px] font-bold text-slate-500 flex-shrink-0 tabular-nums">
                {{ post.poll.totalVotes > 0 ? Math.round(option.voters.length / post.poll.totalVotes * 100) : 0 }}%
              </span>
           </div>
        </div>
      </div>
      <div class="mt-2 flex justify-between items-center text-[10px] text-slate-400 font-medium px-1">
          <span>{{ post.poll.totalVotes }} 票</span>
      </div>
    </div>

    <!-- Edit Form -->
    <div v-if="editingPostId === post.id" class="mb-3">
      <input :value="editPostTitle" @input="emit('update:editPostTitle', ($event.target as HTMLInputElement).value)" type="text" placeholder="貼文標題 (選填)..." class="w-full text-sm text-slate-800 bg-transparent outline-none mb-2 border-b border-gray-200 focus:border-emerald-500 transition-colors placeholder-slate-500">
      <textarea :id="`edit-post-${post.id}`" :value="editContent" @input="emit('update:editContent', ($event.target as HTMLTextAreaElement).value)" :style="{ backgroundColor: editPostColor !== '#ffffff' ? editPostColor : '#f9fafb' }" class="w-full border border-emerald-500 rounded-xl p-3 text-sm text-slate-900 placeholder-slate-500 outline-none resize-none h-28 transition-colors shadow-inner"></textarea>
      <div class="flex justify-between items-center mt-2">
        <div class="flex gap-1">
          <input type="file" ref="fileInput" class="hidden" @change="emit('handleFileSelect', $event)">
          <button @click.stop="($refs.fileInput as any).click()" :disabled="cloudinaryUploading" class="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
        </div>
        <div class="flex gap-2">
          <button @click.stop="emit('cancelEdit')" class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 font-bold border border-gray-200 rounded">取消</button>
          <button @click.stop="emit('saveEdit')" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded font-bold shadow-sm">儲存</button>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div v-else-if="post.content" class="mb-3">
      <div class="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap transition-all overflow-hidden cursor-pointer"
           :class="{'line-clamp-6': !expandedPostsInList && post.content.length > 350}"
           v-html="formatContent(post.content)">
      </div>
      <button v-if="post.content.length > 350" @click.stop="emit('toggleExpandPost')" class="text-emerald-600 hover:text-emerald-700 text-[10px] font-black mt-2 uppercase tracking-widest flex items-center gap-1.5 bg-emerald-50 px-2 py-1 rounded-lg transition-colors">
        {{ expandedPostsInList ? '收起貼文' : '... 繼續閱讀' }}
      </button>
    </div>

    <!-- Attachments -->
    <div v-if="post.attachments?.length" class="space-y-2 mb-3">
      <div v-for="(att, idx) in post.attachments" :key="idx" class="relative group/att">
        <img v-if="att.type === 'image'" :src="att.url" class="w-full h-32 object-cover rounded-lg" @click.stop="emit('openPreview', att.url, 'image')">
        <div v-else-if="att.type === 'youtube'" class="relative aspect-video rounded-lg overflow-hidden"><iframe :src="att.shareUrl" class="absolute inset-0 w-full h-full" allowfullscreen></iframe></div>
        <div v-else class="flex items-center gap-2 p-2 bg-black/5 rounded-lg" @click.stop="emit('openLink', att.url, att.type)">
          <span class="text-xl">{{ att.type === 'pdf' ? '📄' : '🔗' }}</span>
          <span class="text-xs truncate flex-1">{{ att.name }}</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-between border-t border-black/5 mt-3 pt-3">
        <button @click.stop="emit('like')" class="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all group/like" :class="isLiked ? 'text-rose-500 bg-rose-50' : 'text-slate-400 hover:bg-black/5'">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" :fill="isLiked ? 'currentColor' : 'none'" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
            <span class="tabular-nums font-bold">{{ post.likes || 0 }}</span>
        </button>
        <button @click.stop="emit('toggleComments')" class="text-slate-400 hover:text-emerald-500 text-[11px] font-black uppercase flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            {{ post.comments?.length || 0 }} 留言
        </button>
    </div>
  </div>
</template>
