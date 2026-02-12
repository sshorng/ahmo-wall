<script setup lang="ts">
import { computed } from 'vue';
import type { Board } from '../stores/board';

const props = withDefaults(defineProps<{
  currentBoard: Board | null;
  isOwner: boolean;
  canContribute: boolean;
  pendingCount: number;
  currentSort: string;
  sortOptions: { label: string, value: string }[];
  editingBoardTitle: boolean;
  editingBoardDesc: boolean;
  editTitle: string;
  editDesc: string;
  currentUser?: any;
}>(), {
  currentUser: null
});

const emit = defineEmits([
  'goHome', 'openShareModal', 'openSettingsModal', 'handleBatchApprove', 
  'createSection', 'startSlideshow', 'updateSort',
  'startEditTitle', 'saveEditTitle', 'updateTitle',
  'startEditDesc', 'saveEditDesc', 'updateDesc'
]);

const localSort = computed({
  get: () => props.currentSort,
  set: (val) => emit('updateSort', val)
});

const localTitle = computed({
  get: () => props.editTitle,
  set: (val) => emit('updateTitle', val)
});

const localDesc = computed({
  get: () => props.editDesc,
  set: (val) => emit('updateDesc', val)
});
</script>

<template>
  <header class="bg-slate-900/60 backdrop-blur-3xl border-b border-white/10 px-4 py-2.5 flex justify-between items-center z-40 sticky top-0 shadow-2xl transition-all duration-300">
    <div class="flex items-center gap-3">
      <button @click="emit('goHome')" class="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-800/80 hover:bg-slate-700 text-white transition-all border border-white/10 hover:border-white/30 active:scale-95 group shadow-md">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover:scale-110 transition-transform"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      </button>
      
      <div class="flex-1 min-w-0">
        <input v-if="editingBoardTitle && isOwner"
               v-model="localTitle"
               @blur="emit('saveEditTitle')"
               @keydown.enter="emit('saveEditTitle')"
               class="bg-transparent border-b-2 border-emerald-500 text-lg font-black text-white tracking-tight w-full outline-none py-0.5 transition-all"
               autofocus
        />
        <h1 v-else @dblclick="emit('startEditTitle')" 
            :class="['text-lg font-black text-white tracking-tight rounded-lg px-2 -ml-2 transition-all duration-300 flex items-center gap-2', isOwner ? 'cursor-pointer hover:bg-white/10 hover:shadow-lg' : 'cursor-default']">
            {{ currentBoard?.title || '阿墨雲牆' }}
            <svg v-if="isOwner" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="opacity-0 group-hover/h1:opacity-40"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        </h1>

        <input v-if="editingBoardDesc && isOwner"
               v-model="localDesc"
               @blur="emit('saveEditDesc')"
               @keydown.enter="emit('saveEditDesc')"
               class="bg-transparent border-b border-emerald-400/50 text-[10px] text-slate-300 w-full outline-none opacity-80"
               autofocus
        />
        <p v-else @dblclick="emit('startEditDesc')" 
           :class="['text-[10px] text-slate-400 font-bold tracking-tight rounded px-2 -ml-2 transition-all min-h-[1rem] line-clamp-1 opacity-80', isOwner ? 'cursor-pointer hover:bg-white/5' : 'cursor-default']">
           {{ currentBoard?.description || (isOwner ? '✨ 點兩下新增專屬描述...' : '') }}
        </p>
      </div>

      <div v-if="!isOwner && currentBoard" class="ml-2 flex items-center gap-2">
        <div v-if="canContribute" class="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20 shadow-sm animate-pulse-slow">
          <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span class="text-[9px] font-black uppercase tracking-widest">可編輯</span>
        </div>
        <div v-else class="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500/10 text-amber-500 rounded-full border border-amber-500/20 shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"/><circle cx="12" cy="12" r="3"/></svg>
          <span class="text-[9px] font-black uppercase tracking-widest">唯讀模式</span>
        </div>
      </div>
    </div>
    
    <div class="flex items-center gap-2">
      <!-- Sort Select -->
      <div v-if="isOwner" class="relative group/sort hidden md:block">
        <select v-model="localSort" 
                class="appearance-none bg-slate-900/80 hover:bg-slate-800 text-white pl-4 pr-10 py-1.5 rounded-xl text-xs font-bold outline-none border border-emerald-500/30 focus:border-emerald-500 transition-all cursor-pointer shadow-lg backdrop-blur-md min-w-[110px]">
            <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value" class="text-slate-900 bg-white">
                {{ opt.label }}
            </option>
        </select>
        <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-emerald-400 group-hover/sort:scale-110 transition-transform">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </div>
      </div>

      <!-- Action Buttons -->
      <button v-if="isOwner && pendingCount > 0" 
              @click="emit('handleBatchApprove')" 
              class="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-xl text-[10px] font-black transition-all flex items-center gap-1.5 shadow-md shadow-amber-900/30 border border-white/10 active:scale-95 group/batch">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="group-hover/batch:rotate-12 transition-transform"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        核准 ({{ pendingCount }})
      </button>
      
      <button v-if="isOwner" @click="emit('openShareModal')" 
              class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 border border-white/10 active:scale-95 group/share">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover/share:rotate-12 transition-transform"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        分享
      </button>

      <button @click="emit('startSlideshow')" 
              class="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-indigo-950/40 border border-white/10 active:scale-95 group/play">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="group-hover/play:scale-110 transition-transform"><path d="m10 8 6 4-6 4V8z"/></svg>
        播放
      </button>

      <!-- System Icons -->
      <div class="flex items-center gap-1.5 ml-1">
        <button v-if="isOwner" @click="emit('openSettingsModal')" 
                class="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 text-white transition-all border border-white/5 active:scale-95 hover:border-white/20">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>

        <div v-if="currentUser" class="relative group/avatar">
           <img :src="currentUser.photoURL || `https://ui-avatars.com/api/?name=${currentUser.displayName || 'User'}&background=random`" 
                class="w-9 h-9 rounded-xl border border-white/20 object-cover shadow-lg transition-all group-hover:scale-110 group-hover:border-emerald-500 select-none" draggable="false" />
           <div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-900 shadow-sm shadow-emerald-500/50"></div>
        </div>
      </div>
    </div>
  </header>
</template>
