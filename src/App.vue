<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { RouterView } from 'vue-router'
import GlobalModal from './components/common/GlobalModal.vue'
import { useAppConfig } from './composables/useAppConfig'

const { config, isConfigured, saveConfig } = useAppConfig();
import { configUtils } from './composables/useAppConfig'

// Local state for setup form
const setupConfig = reactive({
  firebase: { ...config.firebase },
  cloudinary: { ...config.cloudinary }
});

const rawFirebaseConfig = ref('');

// Watch raw input to parse automatically
watch(rawFirebaseConfig, (val: string) => {
    if (val.includes('apiKey')) {
        const parsed = configUtils.parseFirebaseConfig(val);
        Object.assign(setupConfig.firebase, parsed);
    }
});

const handleSaveSetup = () => {
    if (!setupConfig.firebase.apiKey || !setupConfig.firebase.projectId) {
        alert('請填寫 Firebase 配置！您可以直接貼上代碼，系統會自動解析。');
        return;
    }
    saveConfig(JSON.parse(JSON.stringify(setupConfig)));
    window.location.reload(); // Reload to initialize Firebase with new keys
};
</script>

<template>
  <template v-if="isConfigured">
    <RouterView />
    <GlobalModal />
  </template>
  
  <!-- First Time Setup Overlay -->
  <div v-else class="fixed inset-0 bg-gray-950 text-white flex items-center justify-center p-6 z-[9999] overflow-y-auto">
    <div class="w-full max-w-2xl bg-gray-900 rounded-3xl p-8 border border-white/10 shadow-2xl my-auto">
        <div class="text-center mb-8">
            <div class="text-4xl mb-4">🧱</div>
            <h1 class="text-2xl font-bold mb-2">歡迎使用 阿墨雲牆</h1>
            <p class="text-gray-400 text-sm">請完成初始系統連線設定以開始使用</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div class="space-y-6">
                <section class="space-y-3">
                    <h3 class="text-xs font-bold text-blue-400 uppercase tracking-widest flex justify-between">
                        <span>Firebase 配置</span>
                        <span class="text-[10px] lowercase text-gray-500 font-normal">(Firestore)</span>
                    </h3>
                    
                    <div class="relative">
                        <textarea v-model="rawFirebaseConfig" 
                                  rows="4" 
                                  placeholder="在此貼上 Firebase 控制台的完整 config 代碼... (自動解析)" 
                                  class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[10px] focus:border-blue-500 outline-none transition-colors font-mono resize-none"></textarea>
                        <div v-if="setupConfig.firebase.apiKey" class="absolute top-2 right-2 text-blue-500 text-xs animate-pulse">✓ 已解析</div>
                    </div>

                    <div class="grid grid-cols-1 gap-2 opacity-50 focus-within:opacity-100 transition-opacity">
                        <input v-model="setupConfig.firebase.apiKey" type="password" placeholder="API Key" class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs focus:border-blue-500 outline-none transition-colors">
                        <input v-model="setupConfig.firebase.projectId" type="text" placeholder="Project ID" class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs focus:border-blue-500 outline-none transition-colors">
                        <input v-model="setupConfig.firebase.appId" type="password" placeholder="App ID" class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs focus:border-blue-500 outline-none transition-colors">
                    </div>
                </section>
            </div>

            <div class="space-y-6">
                <section class="space-y-3">
                    <h3 class="text-xs font-bold text-emerald-400 uppercase tracking-widest flex justify-between">
                        <span>Cloudinary 配置</span>
                        <span class="text-[10px] lowercase text-gray-500 font-normal">(Storage)</span>
                    </h3>
                    <input v-model="setupConfig.cloudinary.cloudName" type="text" placeholder="Cloud Name" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:border-emerald-500 outline-none transition-colors">
                    <input v-model="setupConfig.cloudinary.uploadPreset" type="password" placeholder="Upload Preset" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:border-emerald-500 outline-none transition-colors">
                    
                    <div class="pt-2 border-t border-white/5 space-y-2">
                        <p class="text-[10px] text-gray-500 font-bold">管理金鑰 (選填，填入後可真實刪除雲端檔案)</p>
                        <input v-model="setupConfig.cloudinary.apiKey" type="text" placeholder="API Key" class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[10px] focus:border-emerald-500 outline-none transition-colors">
                        <input v-model="setupConfig.cloudinary.apiSecret" type="password" placeholder="API Secret" class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[10px] focus:border-emerald-500 outline-none transition-colors">
                    </div>
                </section>
            </div>
        </div>

        <div class="mt-8 space-y-4">
            <button @click="handleSaveSetup" 
                    class="w-full py-4 bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white rounded-2xl font-bold shadow-xl shadow-blue-900/20 transition-all active:scale-95">
                完成設定並啟動
            </button>
            <p class="text-[10px] text-center text-gray-600">設定將安全地儲存於您的瀏覽器本地記憶體中。此版本名稱已更新為「阿墨雲牆」。</p>
        </div>
    </div>
  </div>
</template>

<style>
/* Global Reset */
body {
  margin: 0;
  padding: 0;
  font-family: 'Noto Sans TC', sans-serif;
}
</style>
