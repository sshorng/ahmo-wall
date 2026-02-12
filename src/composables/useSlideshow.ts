import { ref, computed, type ComputedRef } from 'vue';
import type { Board, Section, Post } from '../stores/board';

export function useSlideshow(
    currentBoard: ComputedRef<Board | null>,
    localSections: ComputedRef<Section[]>,
    filteredAndSortedPostsBySection: ComputedRef<Record<string, Post[]>>
) {
    const showSlideshow = ref(false);
    const currentSlideIndex = ref(0);
    const isPlaying = ref(false);
    let slideTimer: number | null = null;

    const slides = computed(() => {
        const allSlides: { type: 'title' | 'section' | 'post', data: any }[] = [];
        if (currentBoard.value) {
            allSlides.push({ type: 'title', data: currentBoard.value });
        }
        localSections.value.forEach(section => {
            allSlides.push({ type: 'section', data: section });
            const posts = filteredAndSortedPostsBySection.value[section.id] || [];
            posts.forEach(post => {
                allSlides.push({ type: 'post', data: post });
            });
        });
        return allSlides;
    });

    const currentSlide = computed(() => slides.value[currentSlideIndex.value] || null);

    const startSlideTimer = () => {
        stopSlideTimer();
        slideTimer = window.setInterval(() => {
            nextSlide();
        }, 5000);
    };

    const stopSlideTimer = () => {
        if (slideTimer) {
            clearInterval(slideTimer);
            slideTimer = null;
        }
    };

    const nextSlide = () => {
        if (currentSlideIndex.value < slides.value.length - 1) {
            currentSlideIndex.value++;
        } else {
            currentSlideIndex.value = 0;
        }
    };

    const prevSlide = () => {
        if (currentSlideIndex.value > 0) {
            currentSlideIndex.value--;
        } else {
            currentSlideIndex.value = slides.value.length - 1;
        }
    };

    const startSlideshow = () => {
        showSlideshow.value = true;
        currentSlideIndex.value = 0;
        isPlaying.value = false;
        document.body.style.overflow = 'hidden';
        document.documentElement.requestFullscreen().catch(() => { });
    };

    const closeSlideshow = () => {
        showSlideshow.value = false;
        isPlaying.value = false;
        stopSlideTimer();
        document.body.style.overflow = '';
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(err => console.log(err));
        }
    };

    const togglePlayPause = () => {
        isPlaying.value = !isPlaying.value;
        if (isPlaying.value) {
            startSlideTimer();
        } else {
            stopSlideTimer();
        }
    };

    const handleKeydown = (e: KeyboardEvent) => {
        if (!showSlideshow.value) return;
        switch (e.key) {
            case 'ArrowRight':
            case ' ':
                if (e.key === ' ') e.preventDefault();
                nextSlide();
                if (isPlaying.value) startSlideTimer();
                break;
            case 'ArrowLeft':
                prevSlide();
                if (isPlaying.value) startSlideTimer();
                break;
            case 'Escape':
                closeSlideshow();
                break;
        }
    };

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => { });
        } else {
            document.exitFullscreen().catch(() => { });
        }
    };

    return {
        showSlideshow,
        currentSlideIndex,
        isPlaying,
        slides,
        currentSlide,
        startSlideshow,
        closeSlideshow,
        togglePlayPause,
        handleKeydown,
        nextSlide,
        prevSlide,
        toggleFullscreen
    };
}
