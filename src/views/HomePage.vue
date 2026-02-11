<script setup lang="ts">
import { ref, onMounted, computed, watch, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { useBoardStore, type Board } from '../stores/board';
import { useAuthStore } from '../stores/auth';
import { useAppConfig, configUtils } from '../composables/useAppConfig';
import { useModal } from '../composables/useModal';
import { doc, deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import QrcodeVue from 'qrcode.vue';

const router = useRouter();
const boardStore = useBoardStore();
const authStore = useAuthStore();

// Local state
const showCreateModal = ref(false);
const newBoardTitle = ref('');
const newBoardLayout = ref<'shelf' | 'wall' | 'stream'>('shelf');
const searchQuery = ref('');

// Config Management
const { config: appConfig, saveConfig, resetConfig, generateShareLink } = useAppConfig();
const modal = useModal();
const showSettingsModal = ref(false);
const localConfig = reactive({
    firebase: { ...appConfig.firebase },
    cloudinary: { ...appConfig.cloudinary },
    appTitle: appConfig.appTitle || '',
    allowedEmails: [...(appConfig.allowedEmails || [])]
});
const rawFirebaseConfig = ref('');
const whitelistTextInput = ref('');

const loadGlobalSettings = async () => {
    if (!db) {
        console.warn('[Config] Firebase 未初始化，暫法無法載入雲端設定');
        return;
    }
    try {
        // 1. 載入一般全域設定 (現在是公開可讀)
        const docSnap = await getDoc(doc(db, 'configs', 'global'));
        if (docSnap.exists()) {
            const data = docSnap.data();
            localConfig.appTitle = data.siteTitle || '阿墨互動牆';
            localConfig.allowedEmails = data.whitelistEmails || [];
            whitelistTextInput.value = localConfig.allowedEmails.join(', ');
            
            // 同步至全域常數，讓 Sidebar 等組件即時更新
            appConfig.appTitle = localConfig.appTitle;
            appConfig.allowedEmails = localConfig.allowedEmails;
        }

        // 2. 載入 Cloudinary 基本連線 (公開)
        const cloudinarySnap = await getDoc(doc(db, 'configs', 'cloudinary'));
        if (cloudinarySnap.exists()) {
            const cData = cloudinarySnap.data();
            localConfig.cloudinary.cloudName = cData.cloudName || localConfig.cloudinary.cloudName;
            localConfig.cloudinary.uploadPreset = cData.uploadPreset || localConfig.cloudinary.uploadPreset;
            appConfig.cloudinary.cloudName = localConfig.cloudinary.cloudName;
            appConfig.cloudinary.uploadPreset = localConfig.cloudinary.uploadPreset;
        }

        // 3. 載入 Cloudinary 私密金鑰 (需登入)
        if (authStore.user) {
            const secretsSnap = await getDoc(doc(db, 'configs', 'cloudinary_secrets'));
            if (secretsSnap.exists()) {
                const sData = secretsSnap.data();
                localConfig.cloudinary.apiKey = sData.apiKey || '';
                localConfig.cloudinary.apiSecret = sData.apiSecret || '';
                console.log('[Config] Cloudinary 密鑰已從安全區載入');
            }
        }
    } catch (e) {
        console.warn('[Config] 載入雲端設定失敗，可能尚未設定或權限不足');
    }
};

const saveGlobalSettings = async () => {
    if (!db || !authStore.user) return;
    try {
        const emails = whitelistTextInput.value.split(',').map(e => e.trim()).filter(e => e);
        await setDoc(doc(db, 'configs', 'global'), {
            siteTitle: localConfig.appTitle,
            whitelistEmails: emails,
            updatedAt: new Date()
        }, { merge: true });
        
        appConfig.appTitle = localConfig.appTitle;
        appConfig.allowedEmails = emails;
    } catch (e) {
        console.error('[Config] 儲存全域設定失敗', e);
        throw e;
    }
};

// watch removed

// Watch for auth changes to load private settings
watch(() => authStore.user, (user) => {
    if (user) {
        loadGlobalSettings();
    }
}, { immediate: true });

// Watch raw input to parse automatically
watch(rawFirebaseConfig, (val) => {
    if (val.includes('apiKey')) {
        const parsed = configUtils.parseFirebaseConfig(val);
        Object.assign(localConfig.firebase, parsed);
    }
});

const handleSaveConfig = async () => {
    // 1. 儲存全域設定至資料庫 (如果已登入)
    if (authStore.user) {
        await saveGlobalSettings();
    }

    // 2. 儲存核心 Firebase 配置到 LocalStorage
    saveConfig(JSON.parse(JSON.stringify(localConfig)));

    // 2. 嘗試同步 Cloudinary 參數至資料庫
    let syncSuccess = false;
    let authError = false;

    if (db && localConfig.cloudinary.cloudName) {
        if (!authStore.user) {
            authError = true;
        } else {
            try {
                // A. 儲存公開參數
                await setDoc(doc(db, 'configs', 'cloudinary'), {
                    cloudName: localConfig.cloudinary.cloudName,
                    uploadPreset: localConfig.cloudinary.uploadPreset,
                    updatedAt: new Date()
                }, { merge: true });

                // B. 儲存私密金鑰 (安全區塊)
                await setDoc(doc(db, 'configs', 'cloudinary_secrets'), {
                    apiKey: localConfig.cloudinary.apiKey || '',
                    apiSecret: localConfig.cloudinary.apiSecret || '',
                    updatedAt: new Date()
                }, { merge: true });
                
                syncSuccess = true;
            } catch (e: any) {
                console.error('[Config] 同步至資料庫失敗:', e);
            }
        }
    }

    showSettingsModal.value = false;
    
    if (syncSuccess) {
        modal.success('系統設定已儲存並同步至雲端資料庫！');
    } else if (authError) {
        modal.warning('Firebase 設定已儲存，但因「尚未登入」無法同步雲端參數。請先登入，再完成同步。');
    } else {
        modal.success('系統設定已儲存！');
    }
};

const handleResetConfig = async () => {
    const confirmed = await modal.confirm('確定要清除所有自訂設定並還原預設值嗎？', '清除設定', 'error');
    if (confirmed) {
        resetConfig();
        window.location.reload();
    }
};

const copyShareLink = async () => {
    const url = generateShareLink();
    await navigator.clipboard.writeText(url);
    modal.success('加密分享連結已複製！');
};



// Create new board
const createBoard = async () => {
  if (!newBoardTitle.value) return;

  // Whitelist Check
  const allowed = appConfig.allowedEmails || [];
  if (allowed.length > 0) {
      const userEmail = authStore.user?.email;
      if (!userEmail || !allowed.includes(userEmail)) {
          modal.error('系統已啟用白名單限制，您無權建立看板。');
          return;
      }
  }
  
  const id = await boardStore.createBoard({
    title: newBoardTitle.value,
    layout: newBoardLayout.value
  });
  
  showCreateModal.value = false;
  newBoardTitle.value = '';
  router.push(`/board/${id}`);
};

// Navigate to board
const openBoard = (board: Board) => {
  router.push(`/board/${board.id}`);
};

const openBoardSettings = (board: Board) => {
    // Navigate to board with a query param to open settings immediately
    router.push(`/board/${board.id}?action=settings`);
};

// Menu Actions
const activeMenuBoardId = ref<string | null>(null);
const editingBoardId = ref<string | null>(null);
const editingTitle = ref('');
const editingDescription = ref('');
const isEditingDescription = ref(false);

const toggleMenu = (boardId: string, e: Event) => {
    e.stopPropagation();
    activeMenuBoardId.value = activeMenuBoardId.value === boardId ? null : boardId;
};

const startEditBoard = (board: Board, editDesc = false) => {
    editingBoardId.value = board.id;
    editingTitle.value = board.title;
    editingDescription.value = board.description || '';
    isEditingDescription.value = editDesc;
    activeMenuBoardId.value = null;
};

const saveEditBoard = async (board: Board) => {
    if (!editingTitle.value.trim()) return;
    await boardStore.updateBoard(board.id, { 
        title: editingTitle.value,
        description: editingDescription.value
    });
    editingBoardId.value = null;
    isEditingDescription.value = false;
    modal.success('看板資料已更新');
};

const handleDeleteBoard = async (board: Board) => {
    activeMenuBoardId.value = null;
    const confirmed = await modal.confirm(`確定要刪除看板「${board.title}」嗎？此動作無法復原。`);
    if (confirmed) {
         try {
             await deleteDoc(doc(db, 'boards', board.id));
             modal.success('看板已刪除');
         } catch (e: any) {
             modal.error('刪除失敗: ' + e.message);
         }
    }
};

// Folders Logic
const selectedFolderId = ref<string | null>(null);
const showFolderMenu = ref<string | null>(null); // To toggle move folder sub-menu

const currentFolderTitle = computed(() => {
    if (!selectedFolderId.value) return '所有看板';
    if (selectedFolderId.value === 'uncategorized') return '未分類';
    const folder = boardStore.folders.find(f => f.id === selectedFolderId.value);
    return folder ? folder.title : '分類';
});

const createFolder = async () => {
    const title = window.prompt('請輸入新分類名稱：');
    if (title && title.trim()) {
        try {
            await boardStore.createFolder(title.trim());
            modal.success('分類已建立');
        } catch (e: any) {
            modal.error('建立失敗：' + e.message);
        }
    }
};

const deleteFolder = async (folder: any) => {
    if (await modal.confirm(`確定要刪除分類「${folder.title}」嗎？裡面的看板將變回未分類。`)) {
        await boardStore.deleteFolder(folder.id);
        if (selectedFolderId.value === folder.id) selectedFolderId.value = null;
        modal.success('分類已刪除');
    }
};

const moveBoard = async (board: Board, folderId: string | null) => {
    await boardStore.moveBoardToFolder(board.id, folderId);
    activeMenuBoardId.value = null;
    showFolderMenu.value = null;
    modal.success('看板已移動');
};

const handleBoardDragStart = (e: DragEvent, board: Board) => {
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('boardId', board.id);
        
        // Create a transparent drag image or customize if needed
        // For now, just ensuring it's recognized as an internal move
    }
    // Stop propagation to prevent parent elements or extensions from hijacking
    e.stopPropagation();
};

const draggingOverFolderId = ref<string | null>(null);

const handleFolderDrop = async (e: DragEvent, folderId: string | null) => {
    e.preventDefault();
    draggingOverFolderId.value = null;
    const boardId = e.dataTransfer?.getData('boardId');
    if (boardId) {
        await boardStore.moveBoardToFolder(boardId, folderId);
        modal.success('看板已移動至分類');
    }
};

// Logout
const handleLogout = async () => {
  await authStore.logout();
  router.push('/login');
};



const displayBoards = computed(() => {
  const allBoards = boardStore.boards;
  const user = authStore.user;

  if (!user) return [];

  let myBoards = allBoards.filter(b => b.ownerId === user.uid);
  
  // Filter by folder
  if (selectedFolderId.value === 'uncategorized') {
      myBoards = myBoards.filter(b => !b.folderId);
  } else if (selectedFolderId.value) {
      myBoards = myBoards.filter(b => b.folderId === selectedFolderId.value);
  }
  
  // Apply search
  if (searchQuery.value) {
    return myBoards.filter(b => b.title.toLowerCase().includes(searchQuery.value.toLowerCase()));
  }

  return myBoards;
});

// Initialize
onMounted(() => {
  boardStore.subscribeToBoards();
  document.title = appConfig.appTitle || '阿墨互動牆';
  loadGlobalSettings();
});

watch(() => appConfig.appTitle, (newTitle) => {
    document.title = newTitle || '阿墨互動牆';
});

// Background images for cards (random selection for demo)
const backgrounds = [
  'https://images.unsplash.com/photo-1462275646964-a0e3571f4f1f?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1516541196182-6bdb0516ed27?auto=format&fit=crop&w=600&q=80',
];

const getBackground = (index: number) => {
  return backgrounds[index % backgrounds.length];
};
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-900 via-gray-900 to-slate-900 text-white font-sans">
    
    <!-- Sidebar -->
    <aside class="fixed left-0 top-0 h-full w-64 bg-black/40 backdrop-blur-xl border-r border-white/10 p-4 flex flex-col z-20">
      <!-- Logo -->
      <div class="flex items-center gap-3 mb-10">
        <div class="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-900/40">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
        </div>
        <div>
          <h1 class="font-bold text-lg tracking-tight">{{ appConfig.appTitle || '阿墨互動牆' }}</h1>
          <p class="text-[10px] text-gray-400 font-medium uppercase tracking-widest opacity-60">Creative Space</p>
        </div>
      </div>

      <!-- Search -->
      <div class="relative mb-8">
        <input v-model="searchQuery"
               type="text" 
               placeholder="搜尋看板..." 
               class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 focus:bg-white/10 transition-all">
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </span>
      </div>

      <!-- Navigation -->
      <nav class="space-y-1.5 mb-8">
        <button @click="selectedFolderId = null" 
                @dragover.prevent="draggingOverFolderId = 'all'"
                @dragleave="draggingOverFolderId = null"
                @drop="(e) => handleFolderDrop(e, null)"
                :class="['w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all', !selectedFolderId ? 'bg-emerald-500/10 text-emerald-400 font-bold' : 'text-gray-400 hover:bg-white/5 hover:text-white', draggingOverFolderId === 'all' ? 'ring-2 ring-emerald-500 bg-emerald-500/10' : '']">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          所有看板
        </button>
        
        <div class="mt-8 mb-3 px-3 flex justify-between items-center text-[10px] text-gray-500 uppercase tracking-[0.2em] font-bold opacity-60">
            <span>列表與分類</span>
            <button @click="createFolder" class="hover:text-emerald-400 transition-colors p-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            </button>
        </div>

        <div class="space-y-1 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
            <button v-for="folder in boardStore.folders" :key="folder.id"
                    @click="selectedFolderId = folder.id"
                    @dragover.prevent="draggingOverFolderId = folder.id"
                    @dragleave="draggingOverFolderId = null"
                    @drop="(e) => handleFolderDrop(e, folder.id)"
                    :class="['w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group/folder', selectedFolderId === folder.id ? 'bg-white/10 text-emerald-400 font-bold' : 'text-gray-400 hover:bg-white/5 hover:text-white', draggingOverFolderId === folder.id ? 'ring-2 ring-emerald-500 bg-emerald-500/10' : '']">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
                <span class="flex-1 text-left truncate">{{ folder.title }}</span>
                <button @click.stop="deleteFolder(folder)" class="opacity-0 group-hover/folder:opacity-100 hover:text-red-400 transition-all translate-x-1 group-hover/folder:translate-x-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
            </button>
            
            <button @click="selectedFolderId = 'uncategorized'"
                    @dragover.prevent="draggingOverFolderId = 'uncategorized'"
                    @dragleave="draggingOverFolderId = null"
                    @drop="(e) => handleFolderDrop(e, null)"
                    :class="['w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all', selectedFolderId === 'uncategorized' ? 'bg-amber-400/10 text-amber-400 font-bold' : 'text-gray-400 hover:bg-white/5 hover:text-white', draggingOverFolderId === 'uncategorized' ? 'ring-2 ring-amber-500 bg-amber-500/10' : '']">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
                未分類
            </button>
        </div>

        <div class="pt-6 border-t border-white/5 mt-6">
            <button @click="showSettingsModal = true" class="w-full h-11 flex items-center gap-3 px-3 rounded-xl text-blue-400 hover:bg-blue-400/10 border border-transparent hover:border-blue-400/20 transition-all group/settings">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="group-hover/settings:rotate-90 transition-transform duration-500"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
              系統設定
            </button>
        </div>
      </nav>

      <!-- Spacer -->
      <div class="flex-1"></div>

      <!-- User Profile -->
      <div class="bg-white/5 rounded-2xl p-4 border border-white/5">
        <div class="flex items-center gap-3 mb-4">
          <div class="relative">
            <img v-if="authStore.user?.photoURL" :src="authStore.user.photoURL" class="w-10 h-10 rounded-full border-2 border-emerald-500/30">
            <div v-else class="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold text-sm">
              {{ authStore.user?.displayName?.charAt(0) || '?' }}
            </div>
            <div class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-gray-900 rounded-full"></div>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-bold text-sm truncate text-white/90">{{ authStore.user?.displayName || '訪客' }}</p>
            <p class="text-[10px] text-gray-500 font-medium">個人主頁</p>
          </div>
        </div>
        <button @click="handleLogout" class="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all border border-transparent hover:border-red-400/20">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          登出系統
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="ml-64 p-8">
      <!-- Header -->
      <div class="flex justify-between items-center mb-8">
        <div>
          <h2 class="text-3xl font-bold mb-1">{{ currentFolderTitle }}</h2>
          <p class="text-gray-400">共 {{ displayBoards.length }} 個看板</p>
        </div>
        <div class="flex items-center gap-4">
          <select class="bg-transparent border border-white/20 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-emerald-500">
            <option value="name">名稱</option>
            <option value="date">上次修改</option>
          </select>
        </div>
      </div>

      <!-- Boards Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        
        <!-- Create New Board Card -->
        <div @click="showCreateModal = true"
             class="aspect-[4/3] bg-white/[0.03] border-2 border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/[0.05] transition-all group overflow-hidden relative">
          <div class="absolute inset-0 bg-emerald-500/[0.02] opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div class="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center text-emerald-500 mb-4 group-hover:scale-110 group-hover:bg-emerald-500/20 transition-all duration-500 border border-white/5">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          </div>
          <p class="text-sm font-bold text-gray-500 group-hover:text-emerald-400 transition-colors uppercase tracking-widest">建立新看板</p>
        </div>

        <!-- Board Cards -->
        <div v-for="(board, index) in displayBoards" :key="board.id"
             @click="openBoard(board)"
             draggable="true"
             @dragstart="(e) => handleBoardDragStart(e, board)"
             class="aspect-[4/3] rounded-2xl overflow-hidden relative group cursor-pointer shadow-lg hover:shadow-2xl transition-all hover:scale-[1.02] active:scale-95 active:rotate-1 select-none">
          
          <!-- Background Image -->
          <div class="absolute inset-0 bg-cover bg-center"
               :style="{ backgroundImage: `url(${board.backgroundImage || getBackground(index)})` }">
          </div>
          
          <!-- Gradient Overlay -->
          <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
          
          <!-- Content -->
          <div class="absolute bottom-0 left-0 right-0 p-4">
            <div v-if="editingBoardId === board.id" @click.stop class="space-y-2">
                 <input v-model="editingTitle" 
                        @blur="!isEditingDescription && saveEditBoard(board)"
                        @keydown.enter="saveEditBoard(board)"
                        @click.stop
                        placeholder="看板標題"
                        class="w-full bg-black/50 border border-emerald-500 rounded px-2 py-1 text-lg font-bold text-white outline-none"
                        autofocus />
                 <textarea v-if="isEditingDescription"
                           v-model="editingDescription"
                           @blur="saveEditBoard(board)"
                           @keydown.enter="saveEditBoard(board)"
                           @click.stop
                           placeholder="看板描述..."
                           class="w-full bg-black/50 border border-emerald-500 rounded px-2 py-1 text-sm text-gray-200 outline-none resize-none"
                           rows="2"></textarea>
            </div>
            <template v-else>
                <h3 class="font-bold text-lg text-white mb-1 line-clamp-2">{{ board.title }}</h3>
                <p class="text-sm text-gray-300 line-clamp-1">{{ board.description || '無描述' }}</p>
            </template>
          </div>

          <!-- Layout Badge -->
          <div class="absolute top-4 right-4 flex flex-col gap-1.5 items-end">
             <div class="px-2.5 py-1 bg-black/60 backdrop-blur-md rounded-lg text-[10px] font-bold text-white/90 border border-white/10 flex items-center gap-1.5">
                <template v-if="board.layout === 'shelf'">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="18" x="3" y="3" rx="1"/><rect width="8" height="18" x="13" y="3" rx="1"/><path d="M3 9h8"/><path d="M13 9h8"/></svg>
                  書架
                </template>
                <template v-else-if="board.layout === 'stream'">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><path d="M3 6h18"/><path d="M3 18h18"/></svg>
                  串流
                </template>
                <template v-else>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>
                  牆面
                </template>
             </div>
              <div v-if="board.privacy !== 'public' || board.guestPermission === 'view'" class="px-2.5 py-1 bg-black/60 backdrop-blur-md rounded-lg text-[10px] font-bold text-white/90 border border-white/10 flex items-center gap-1.5">
                <template v-if="board.guestPermission === 'view'">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"/><circle cx="12" cy="12" r="3"/></svg>
                  唯讀
                </template>
                <template v-else-if="board.privacy === 'private'">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                  私密
                </template>
                <template v-else>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  密碼
                </template>
              </div>
          </div>

          <!-- Hover Menu Trigger -->
          <div class="absolute top-4 left-4 z-10">
              <button @click="(e) => toggleMenu(board.id, e)" 
                      class="w-9 h-9 bg-black/60 backdrop-blur-md rounded-xl flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all border border-white/10 hover:bg-emerald-500 hover:border-emerald-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
              </button>
              
              <!-- Dropdown Menu -->
              <div v-if="activeMenuBoardId === board.id" 
                   class="absolute left-0 top-10 w-48 bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-scale-in origin-top-left flex flex-col z-20"
                   @click.stop>
                  <template v-if="!showFolderMenu">
                      <button @click="startEditBoard(board)" class="text-left px-4 py-3 text-xs font-bold text-gray-300 hover:bg-emerald-500/10 hover:text-emerald-400 flex items-center gap-3 w-full transition-all group/item">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="group-hover/item:rotate-12 transition-transform"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                          重新命名
                      </button>
                      <button @click="startEditBoard(board, true)" class="text-left px-4 py-3 text-xs font-bold text-gray-300 hover:bg-emerald-500/10 hover:text-emerald-400 flex items-center gap-3 w-full transition-all group/item">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="group-hover/item:scale-110 transition-transform"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          修改描述
                      </button>
                      <button @click="openBoardSettings(board)" class="text-left px-4 py-3 text-xs font-bold text-gray-300 hover:bg-blue-500/10 hover:text-blue-400 flex items-center gap-3 w-full transition-all group/item">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="group-hover/item:rotate-90 transition-transform duration-500"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                          設定看板
                      </button>
                      <button @click="showFolderMenu = board.id" class="text-left px-4 py-3 text-xs font-bold text-gray-300 hover:bg-emerald-500/10 hover:text-emerald-400 flex items-center justify-between gap-3 w-full group/move transition-all group/item">
                          <span class="flex items-center gap-3">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="group-hover/item:translate-x-0.5 transition-transform"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
                            移動至分類
                          </span>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-gray-600 group-hover/move:text-emerald-500 transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                      <button @click="handleDeleteBoard(board)" class="text-left px-4 py-3 text-xs font-bold text-red-400 hover:bg-red-500/10 hover:text-red-300 flex items-center gap-3 w-full mt-1 border-t border-white/5 transition-all group/item">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="group-hover/item:-rotate-12 transition-transform"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                          刪除看板
                      </button>
                  </template>
                  
                  <template v-else>
                      <div class="px-3 py-2.5 text-[10px] text-gray-500 font-bold uppercase border-b border-white/5 flex items-center gap-2 bg-white/[0.02]">
                          <button @click="showFolderMenu = null" class="w-6 h-6 flex items-center justify-center hover:bg-white/10 rounded-lg transition-colors text-white">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                          </button>
                          選擇分類
                      </div>
                      <div class="max-h-48 overflow-y-auto custom-scrollbar">
                           <button @click="moveBoard(board, null)" class="text-left px-4 py-2.5 text-[11px] font-bold text-gray-400 hover:bg-white/5 hover:text-white flex items-center gap-2.5 w-full transition-all">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
                              未分類
                          </button>
                          <button v-for="folder in boardStore.folders" :key="folder.id"
                                  @click="moveBoard(board, folder.id)"
                                  class="text-left px-4 py-2.5 text-[11px] font-bold text-emerald-500/80 hover:bg-emerald-500/10 hover:text-emerald-400 flex items-center gap-2.5 w-full transition-all">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
                              {{ folder.title }}
                          </button>
                      </div>
                  </template>
              </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Create Board Modal -->
    <div v-if="showCreateModal" 
         class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
         @click.self="showCreateModal = false">
      <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-white/10">
        <h2 class="text-xl font-bold mb-6">建立新看板</h2>
        
        <div class="space-y-4">
          <div>
            <label class="block text-sm text-gray-400 mb-2">看板標題</label>
            <input v-model="newBoardTitle" 
                   type="text" 
                   placeholder="例如：第5課 世說新語" 
                   class="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 transition-colors"
                   @keyup.enter="createBoard">
          </div>
          
            <div>
            <label class="block text-sm text-gray-400 mb-2">版型</label>
            <div class="grid grid-cols-3 gap-3">
              <button @click="newBoardLayout = 'shelf'"
                      :class="['p-4 rounded-xl border-2 transition-all text-left', newBoardLayout === 'shelf' ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/10 hover:border-white/30']">
                <span class="text-2xl mb-2 block">📚</span>
                <span class="font-medium">書架</span>
                <p class="text-[10px] text-gray-400 mt-1">分欄整理</p>
              </button>
              <button @click="newBoardLayout = 'wall'"
                      :class="['p-4 rounded-xl border-2 transition-all text-left', newBoardLayout === 'wall' ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/10 hover:border-white/30']">
                <span class="text-2xl mb-2 block">🧱</span>
                <span class="font-medium">牆面</span>
                <p class="text-[10px] text-gray-400 mt-1">自由貼文</p>
              </button>
              <button @click="newBoardLayout = 'stream'"
                      :class="['p-4 rounded-xl border-2 transition-all text-left', newBoardLayout === 'stream' ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/10 hover:border-white/30']">
                <span class="text-2xl mb-2 block">🌊</span>
                <span class="font-medium">串流</span>
                <p class="text-[10px] text-gray-400 mt-1">垂直分區</p>
              </button>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button @click="showCreateModal = false" class="px-5 py-2.5 text-gray-400 hover:text-white transition-colors">取消</button>
          <button @click="createBoard" 
                  :disabled="!newBoardTitle"
                  class="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-colors">
            建立
          </button>
        </div>
      </div>
    </div>

    <!-- System Settings Modal -->
    <div v-if="showSettingsModal" 
         class="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[100] p-4"
         @click.self="showSettingsModal = false">
      <div class="bg-gray-900 rounded-3xl p-8 w-full max-w-2xl shadow-2xl border border-white/10 max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-8">
          <div>
            <h2 class="text-2xl font-bold text-white flex items-center gap-2">
              <span class="text-blue-400">⚙️</span> 系統連線設定
            </h2>
            <p class="text-xs text-gray-400 mt-1">設定您的 Firebase 與 Cloudinary 參數，將連線至您的私有資料庫。</p>
          </div>
          <button @click="showSettingsModal = false" class="text-gray-500 hover:text-white transition-colors text-2xl">✕</button>
        </div>

        <div class="space-y-8">
          <section class="space-y-4">
            <div class="flex items-center justify-between px-1">
              <h3 class="text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                <span class="w-1 h-4 bg-emerald-500 rounded-full"></span>
                網站全域設定 (同步雲端)
              </h3>
            </div>
            <div class="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1 shadow-sm">網站總標題</label>
                        <input v-model="localConfig.appTitle" type="text" placeholder="範例: 我的專屬互動區" class="w-full bg-slate-950/50 border border-white/5 rounded-2xl px-4 py-2.5 text-sm focus:border-emerald-500 outline-none transition-all">
                    </div>
                    <div>
                        <label class="block text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1">允許建立者清單 (逗號分隔)</label>
                        <input v-model="whitelistTextInput" type="text" placeholder="email1@gmail.com, email2@com" class="w-full bg-slate-950/50 border border-white/5 rounded-2xl px-4 py-2.5 text-sm focus:border-emerald-500 outline-none transition-all font-mono">
                    </div>
                </div>
                <p class="text-[9px] text-gray-500 italic">※ 此設定將儲存於 Firebase `configs/global`，對所有使用者生效。</p>
            </div>
          </section>

          <section class="space-y-4">
            <div class="flex items-center justify-between px-1">
              <h3 class="text-xs font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
                <span class="w-1 h-4 bg-blue-500 rounded-full"></span>
                Firebase (資料庫連線)
              </h3>
              <button @click="handleResetConfig" class="text-[10px] font-black text-gray-500 hover:text-red-400 transition-colors flex items-center gap-1 uppercase tracking-tighter">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                重置設定
              </button>
            </div>

            <div class="bg-white/5 border border-white/10 rounded-[2rem] p-6">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div class="space-y-2">
                    <p class="text-[10px] text-gray-400 font-black uppercase tracking-widest px-1">快速配置 (從控制台貼上)</p>
                    <textarea v-model="rawFirebaseConfig" 
                              rows="5" 
                              placeholder="在此貼上 Firebase SDK 設定代碼 (apiKey: '...', projectID: '...')" 
                              class="w-full bg-slate-950/50 border border-white/10 rounded-2xl px-4 py-3 text-[10px] focus:border-blue-500 outline-none font-mono resize-none transition-all placeholder:text-gray-600 shadow-inner"></textarea>
                  </div>
                  <div class="space-y-3 pt-6">
                    <div>
                        <label class="block text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1 px-1">API Key</label>
                        <input v-model="localConfig.firebase.apiKey" type="password" placeholder="貼上 API Key" class="w-full bg-slate-950/50 border border-white/5 rounded-xl px-4 py-2.5 text-xs focus:border-blue-500 outline-none transition-all">
                    </div>
                    <div>
                        <label class="block text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1 px-1">Project ID</label>
                        <input v-model="localConfig.firebase.projectId" type="text" placeholder="您的 Project ID" class="w-full bg-slate-950/50 border border-white/5 rounded-xl px-4 py-2.5 text-xs focus:border-blue-500 outline-none transition-all">
                    </div>
                  </div>
                </div>
            </div>
          </section>

          <!-- Cloudinary Section -->
          <section class="space-y-4">
            <h3 class="text-sm font-bold text-emerald-400 uppercase tracking-widest">Cloudinary (雲端儲存)</h3>
            <div class="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 mb-4">
                <p class="text-[10px] text-emerald-400">
                    🔒 安全提示：Cloudinary 敏感金鑰 (API Secret) 現在會獨立儲存於您的 Firebase 資料庫中，不會隨網址分享，確保最高安全性。
                </p>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="space-y-3">
                <p class="text-[10px] text-gray-500 font-bold">基本設定</p>
                <input v-model="localConfig.cloudinary.cloudName" type="text" placeholder="Cloud Name" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:border-emerald-500 outline-none">
                <input v-model="localConfig.cloudinary.uploadPreset" type="password" placeholder="Upload Preset" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:border-emerald-500 outline-none">
              </div>
              <div class="space-y-3">
                <p class="text-[10px] text-gray-500 font-bold">進階管理 (儲存至雲端資料庫)</p>
                <input v-model="localConfig.cloudinary.apiKey" type="text" placeholder="API Key" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:border-emerald-500 outline-none">
                <input v-model="localConfig.cloudinary.apiSecret" type="password" placeholder="API Secret" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-emerald-500 outline-none">
              </div>
            </div>
          </section>

          <!-- Share Section -->
          <section class="space-y-4 pt-6 border-t border-white/5">
            <h3 class="text-sm font-bold text-amber-400 uppercase tracking-widest text-center">分享加密連線設定</h3>
            <div class="bg-white/5 rounded-2xl p-6 flex flex-col md:flex-row items-center gap-8 shadow-inner">
               <div class="bg-white p-3 rounded-xl shadow-lg">
                 <qrcode-vue :value="generateShareLink()" :size="150" level="H" class="rounded-lg" />
               </div>
               <div class="flex-1 space-y-4 text-center md:text-left">
                 <p class="text-xs text-gray-400 leading-relaxed">
                   其他人掃描 QR Code 或打開加密連結將自動套用您的連線參數。
                   <br><span class="text-amber-500/50">⚠ 金鑰將以 Base64 編碼，請僅分享給信任的人。</span>
                 </p>
                 <div class="flex flex-wrap gap-2 justify-center md:justify-start">
                   <button @click="copyShareLink" class="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2 rounded-xl text-sm font-bold transition-all shadow-lg shadow-amber-900/20 active:scale-95 flex items-center gap-2">
                     <span>📋</span> 複製加密連結
                   </button>
                 </div>
               </div>
            </div>
          </section>
        </div>

        <!-- Foot Actions -->
        <div class="flex justify-end gap-3 mt-10 pt-6 border-t border-white/10">
          <button @click="showSettingsModal = false" class="px-6 py-2.5 text-gray-400 hover:text-white transition-colors">取消</button>
          <button @click="handleSaveConfig" class="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20 active:scale-95">
            儲存並套用
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
