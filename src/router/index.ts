import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import HomePage from '../views/HomePage.vue';
import DashboardView from '../views/DashboardView.vue';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/login',
            name: 'login',
            component: LoginView
        },
        {
            path: '/',
            name: 'home',
            component: HomePage,
            meta: { requiresAuth: true }
        },
        {
            path: '/board/:id',
            name: 'board',
            component: DashboardView,
            // Allow public access, auth check is done inside component
            meta: { requiresAuth: false }
        }
    ]
});

router.beforeEach(async (to, _from, next) => {
    const authStore = useAuthStore();
    if (authStore.loading) await authStore.init();

    if (to.meta.requiresAuth && !authStore.user) {
        next('/login');
    } else {
        next();
    }
});

export default router;
