import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '考勤明细采集器',
    description: '在本地保存已登录考勤明细页面的 HTML 快照。',
    action: {
      default_title: '打开考勤明细采集器',
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  webExt: {
    disabled: true,
  },
});
