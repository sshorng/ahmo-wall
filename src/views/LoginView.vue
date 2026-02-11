<script setup lang="ts">
import { useAuthStore } from '../stores/auth';
import { useRouter } from 'vue-router';
import { ref } from 'vue';

const authStore = useAuthStore();
const router = useRouter();
const isLoading = ref(false);
const error = ref('');

const handleLogin = async () => {
  isLoading.value = true;
  error.value = '';
  try {
    await authStore.loginGoogle();
    router.push('/'); // Redirect to Dashboard
  } catch (err: any) {
    error.value = err.message || '登入失敗，請檢查網路或稍後再試。';
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-secondary/30 relative overflow-hidden">
    <!-- Background Decor (Circles) -->
    <div class="absolute -top-20 -left-20 w-80 h-80 bg-primary/10 rounded-full blur-3xl"></div>
    <div class="absolute bottom-10 right-10 w-60 h-60 bg-purple-300/20 rounded-full blur-2xl"></div>

    <div class="relative bg-white/70 backdrop-blur-xl border border-white/50 shadow-2xl rounded-3xl p-10 max-w-md w-full text-center z-10 transition-all hover:shadow-[0_20px_60px_-15px_rgba(123,102,153,0.3)]">
      <div class="w-20 h-20 bg-gradient-to-br from-primary to-purple-400 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg transform rotate-3 hover:rotate-6 transition-transform">
        <span class="text-4xl text-white">🪶</span>
      </div>
      
      <h1 class="text-3xl font-bold font-serif text-gray-800 mb-2">阿墨 Ah Mo</h1>
      <p class="text-gray-500 mb-8 font-light">您的雲端互動式記帳牆</p>
      
      <button 
        @click="handleLogin"
        :disabled="isLoading"
        class="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-700 font-bold py-3.5 px-6 rounded-xl border border-gray-200 transition-all shadow-sm hover:shadow-md active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed group">
        <img src="https://www.svgrepo.com/show/475656/google-color.svg" class="w-6 h-6 group-hover:scale-110 transition-transform" alt="Google Logo" />
        <span>{{ isLoading ? '登入中...' : '使用 Google 帳號登入' }}</span>
      </button>

      <p class="text-red-500 text-sm mt-4 min-h-[20px]">{{ error }}</p>
      
      <div class="mt-8 text-xs text-gray-400">
        &copy; 2026 Ah Mo Team. Designed for Education.
      </div>
    </div>
  </div>
</template>
