import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/diff',
      name: 'diff',
      component: () => import('@/views/DiffView.vue'),
    },
    {
      path: '/test-pattern',
      name: 'test-pattern',
      component: () => import('@/views/TestPatternView.vue'),
    },
  ],
})

export default router
