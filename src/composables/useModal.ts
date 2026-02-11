import { ref, reactive } from 'vue';

type ModalType = 'info' | 'success' | 'warning' | 'error' | 'confirm';

interface ModalOptions {
    title: string;
    message: string;
    type: ModalType;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
}

const isOpen = ref(false);
const options = reactive<ModalOptions>({
    title: '',
    message: '',
    type: 'info',
    confirmText: '確定',
    cancelText: '取消',
});

let resolvePromise: ((value: boolean) => void) | null = null;

export const useModal = () => {
    const showModal = (opts: Partial<ModalOptions>) => {
        isOpen.value = true;
        Object.assign(options, {
            title: '',
            message: '',
            type: 'info',
            confirmText: '確定',
            cancelText: '取消',
            ...opts
        });

        return new Promise<boolean>((resolve) => {
            resolvePromise = resolve;
        });
    };

    const alert = (message: string, title = '提示', type: ModalType = 'info') => {
        return showModal({ message, title, type, confirmText: '好' });
    };

    const confirm = (message: string, title = '確認', type: ModalType = 'confirm') => {
        return showModal({ message, title, type, confirmText: '確定', cancelText: '取消' });
    };

    const success = (message: string, title = '成功') => {
        return showModal({ message, title, type: 'success', confirmText: '好' });
    };

    const error = (message: string, title = '錯誤') => {
        return showModal({ message, title, type: 'error', confirmText: '好' });
    };

    const warning = (message: string, title = '警告') => {
        return showModal({ message, title, type: 'warning', confirmText: '好' });
    };

    const handleConfirm = () => {
        isOpen.value = false;
        if (options.onConfirm) options.onConfirm();
        if (resolvePromise) resolvePromise(true);
    };

    const handleCancel = () => {
        isOpen.value = false;
        if (options.onCancel) options.onCancel();
        if (resolvePromise) resolvePromise(false);
    };

    return {
        isOpen,
        options,
        alert,
        confirm,
        success,
        error,
        warning,
        handleConfirm,
        handleCancel
    };
};
