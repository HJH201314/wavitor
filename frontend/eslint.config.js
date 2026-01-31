import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['*.vue', '**/*.vue', '**/*.ts', '*.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        // 浏览器全局变量
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        // DOM 类型
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLAudioElement: 'readonly',
        CanvasRenderingContext2D: 'readonly',
        // 事件类型
        Event: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        DragEvent: 'readonly',
        WheelEvent: 'readonly',
        CustomEvent: 'readonly',
        EventListener: 'readonly',
        // Web API 类型
        File: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        AudioContext: 'readonly',
        AudioBuffer: 'readonly',
        AnalyserNode: 'readonly',
        GainNode: 'readonly',
        AudioBufferSourceNode: 'readonly',
        OfflineAudioContext: 'readonly',
      },
    },
    rules: {
      // 强制使用分号
      'semi': ['error', 'always'],
      // 强制在对象和数组字面量中使用尾随逗号（多行时）
      'comma-dangle': ['error', {
        arrays: 'always-multiline',
        objects: 'always-multiline',
        imports: 'always-multiline',
        exports: 'always-multiline',
        functions: 'never',
      }],
      // Vue 相关规则
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'warn',
      // TypeScript 相关规则调整
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },
  {
    ignores: ['dist', 'node_modules', '*.config.js', '*.config.ts'],
  }
);
