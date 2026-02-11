<script setup lang="ts">
import { useModal } from '../../composables/useModal';

const { isOpen, options, handleConfirm, handleCancel } = useModal();
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="isOpen" 
         @click.self="handleCancel"
         class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in border border-gray-100">
        <!-- Header Icons based on type -->
        <div class="pt-8 pb-4 flex justify-center">
            <div v-if="options.type === 'success'" class="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 text-3xl">
                ✔
            </div>
            <div v-else-if="options.type === 'error'" class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600 text-3xl font-bold">
                !
            </div>
            <div v-else-if="options.type === 'warning' || options.type === 'confirm'" class="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 text-3xl font-bold">
                ?
            </div>
            <div v-else class="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-3xl">
                ℹ
            </div>
        </div>

        <div class="px-6 pb-6 text-center">
          <h2 class="text-xl font-bold text-gray-800 mb-2">{{ options.title }}</h2>
          <p class="text-gray-500 text-sm leading-relaxed mb-8">{{ options.message }}</p>
          
          <div class="flex gap-3">
            <button v-if="options.type === 'confirm'" 
                    @click="handleCancel" 
                    class="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-colors">
              {{ options.cancelText }}
            </button>
            <button @click="handleConfirm" 
                    :class="[
                        'flex-1 px-4 py-2.5 rounded-xl text-white font-bold transition-all shadow-md active:scale-95',
                        options.type === 'error' ? 'bg-red-500 hover:bg-red-600 shadow-red-200' :
                        options.type === 'warning' ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' :
                        options.type === 'confirm' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200' :
                        'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                    ]">
              {{ options.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.animate-scale-in {
  animation: scale-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes scale-up {
  from { transform: scale(0.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
</style>
