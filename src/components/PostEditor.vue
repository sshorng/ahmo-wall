<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  newPostTitle: string;
  newPostContent: string;
  newPostColor: string;
  pendingAttachments: any[];
  isPoll: boolean;
  pollOptions: { id: string, text: string }[];
  postColors: { name: string, value: string }[];
  cloudinaryUploading: boolean;
  activeSectionId: string;
}>();

const emit = defineEmits([
  'submit', 'cancel', 'handleFileSelect', 'cameraSelect', 'removeAttachment', 
  'togglePoll', 'addPollOption', 'removePollOption',
  'update:newPostTitle', 'update:newPostContent', 'update:newPostColor', 'update:pollOption'
]);

const fileInput = ref<HTMLInputElement | null>(null);
const cameraInput = ref<HTMLInputElement | null>(null);
</script>

<template>
  <div class="bg-white rounded-[2rem] p-5 shadow-2xl border border-white/20 animate-slide-in-left sticky top-24 z-30 w-full overflow-hidden">
    <div class="flex items-center gap-3 mb-5 px-1">
      <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </div>
      <div>
        <h3 class="font-black text-gray-800 text-base tracking-tight m-0 leading-tight">新增貼文</h3>
        <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5 opacity-70">發佈到此區段</p>
      </div>
    </div>

    <!-- Title Input -->
    <input :value="newPostTitle" @input="emit('update:newPostTitle', ($event.target as HTMLInputElement).value)" type="text" placeholder="輸入標題 (選填)" class="w-full text-base font-bold text-gray-800 bg-gray-50/50 rounded-xl px-4 py-3 mb-3 border border-transparent focus:border-emerald-500 focus:bg-white outline-none transition-all placeholder-gray-400">

    <!-- Content Area -->
    <div class="relative group mb-3">
        <textarea :value="newPostContent" @input="emit('update:newPostContent', ($event.target as HTMLTextAreaElement).value)" placeholder="寫下任何想法..." :style="{ backgroundColor: newPostColor !== '#ffffff' ? newPostColor : '' }" class="w-full text-sm text-gray-800 bg-gray-50/50 rounded-2xl px-4 py-4 min-h-[160px] border border-transparent focus:border-emerald-500 focus:bg-white outline-none transition-all resize-none placeholder-gray-400 shadow-inner" @keydown.ctrl.enter="emit('submit')"></textarea>
    </div>

    <!-- Poll Editor -->
    <div v-if="isPoll" class="mb-4 space-y-2 bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100/50">
        <div class="flex items-center justify-between mb-2 px-1">
            <span class="text-[10px] font-black text-emerald-600 uppercase tracking-widest">投票選項</span>
            <button @click="emit('addPollOption')" class="text-emerald-600 hover:text-emerald-700 p-1 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
        </div>
        <div v-for="(opt, idx) in pollOptions" :key="opt.id" class="flex gap-2 group/poll">
            <input :value="opt.text" @input="emit('update:pollOption', {index: idx, text: ($event.target as HTMLInputElement).value})" type="text" :placeholder="`選項 ${idx + 1}`" class="flex-1 text-xs bg-white border border-emerald-100 rounded-lg px-3 py-2 outline-none focus:border-emerald-500 focus:shadow-sm transition-all shadow-inner">
            <button @click="emit('removePollOption', idx)" class="text-gray-300 hover:text-red-500 p-1.5 transition-colors opacity-0 group-hover/poll:opacity-100" :disabled="pollOptions.length <= 2"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
    </div>

    <!-- Attachments Preview -->
    <div v-if="pendingAttachments.length > 0" class="flex flex-wrap gap-2 mb-4 p-2 bg-gray-50 rounded-2xl border border-gray-100">
        <div v-for="(att, idx) in pendingAttachments" :key="idx" class="relative group/att w-14 h-14 rounded-xl overflow-hidden border border-gray-200 bg-white">
            <img v-if="att.thumbnailUrl" :src="att.thumbnailUrl" class="w-full h-full object-cover">
            <div v-else class="w-full h-full flex items-center justify-center text-xl bg-gray-50">{{ att.type === 'pdf' ? '📄' : '🔗' }}</div>
            <button @click="emit('removeAttachment', idx)" class="absolute top-0 right-0 p-1 bg-red-500 text-white rounded-bl-lg opacity-0 group-hover/att:opacity-100 transition-opacity"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
    </div>

    <!-- Toolbar -->
    <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between border-t border-gray-100 pt-4">
            <div class="flex gap-1.5">
                <input ref="fileInput" type="file" multiple class="hidden" @change="emit('handleFileSelect', $event)">
                <button @click="fileInput?.click()" class="w-10 h-10 rounded-xl bg-gray-50 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600 border border-gray-100 transition-all active:scale-90" title="上傳檔案">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                </button>
                <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="emit('handleFileSelect', $event)">
                <button @click="cameraInput?.click()" class="w-10 h-10 rounded-xl bg-gray-50 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600 border border-gray-100 transition-all active:scale-90" title="拍照上傳">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </button>
                <button @click="emit('togglePoll')" :class="isPoll ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : 'bg-gray-50 text-gray-500'" class="w-10 h-10 rounded-xl border border-gray-100 transition-all active:scale-90" title="發起投票">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="8" x2="16" y2="8"/></svg>
                </button>
            </div>
            
            <div class="flex gap-1.5 overflow-x-auto pb-1 max-w-[120px] scrollbar-hide">
                <button v-for="color in postColors" :key="color.value" @click="emit('update:newPostColor', color.value)" :style="{ backgroundColor: color.value }" class="w-5 h-5 rounded-full border border-gray-200 flex-shrink-0 transition-transform hover:scale-125" :class="{'ring-2 ring-emerald-500 ring-offset-2': newPostColor === color.value}"></button>
            </div>
        </div>

        <div class="flex gap-3 mt-1">
            <button @click="emit('cancel')" class="flex-1 py-3 text-sm font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest">取消</button>
            <button @click="emit('submit')" :disabled="cloudinaryUploading || (!newPostContent && pendingAttachments.length === 0 && !isPoll)" class="flex-[2] bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-2xl py-3 font-black text-sm shadow-lg shadow-emerald-500/20 active:scale-95 transition-all uppercase tracking-widest">發佈貼文</button>
        </div>
    </div>
  </div>
</template>
