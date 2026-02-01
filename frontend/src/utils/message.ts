import { createApp, h, ref } from 'vue';
import MessageBox from '../components/MessageBox.vue';

export interface MessageOptions {
  title?: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  confirmText?: string;
  showCancel?: boolean;
  cancelText?: string;
}

export function showMessage(options: MessageOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const show = ref(false);
    let app: any = null;

    app = createApp({
      setup() {
        return { show };
      },
      render() {
        return h(MessageBox, {
          ...options,
          show: this.show,
          onClose: (confirmed: boolean) => {
            // 先触发关闭动画
            show.value = false;
            
            // 等待动画完成后清理
            setTimeout(() => {
              resolve(confirmed);
              if (app) {
                app.unmount();
                if (document.body.contains(container)) {
                  document.body.removeChild(container);
                }
              }
            }, 250); // 与 Modal 的动画时间一致
          }
        });
      }
    });

    app.mount(container);
    
    // 下一帧显示，触发进入动画
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        show.value = true;
      });
    });
  });
}

export function alert(message: string, title = '提示') {
  return showMessage({
    title,
    message,
    type: 'info',
    showCancel: false,
    confirmText: '确定'
  });
}

export function confirm(message: string, title = '确认') {
  return showMessage({
    title,
    message,
    type: 'warning',
    showCancel: true,
    confirmText: '确定',
    cancelText: '取消'
  });
}

export function success(message: string, title = '成功') {
  return showMessage({
    title,
    message,
    type: 'success',
    showCancel: false,
    confirmText: '确定'
  });
}

export function error(message: string, title = '错误') {
  return showMessage({
    title,
    message,
    type: 'error',
    showCancel: false,
    confirmText: '确定'
  });
}
