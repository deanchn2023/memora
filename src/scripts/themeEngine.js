/**
 * Memora Theme Engine v2.1
 * 支持 5 种专业主题，用户可自由切换
 * 主题偏好持久化到 localStorage
 */
const ThemeEngine = (() => {
  const STORAGE_KEY = 'memora-theme';
  const DEFAULT_THEME = 'sky-blue';

  const THEMES = {
    'sky-blue': {
      name: '天空蓝',
      icon: '🌤',
      description: '清新明亮，Apple 经典风格',
      vars: {
        '--primary-color': '#4F8EF7',
        '--primary-hover': '#3A75E0',
        '--primary-light': 'rgba(79, 142, 247, 0.08)',
        '--primary-glow': 'rgba(79, 142, 247, 0.25)',
        '--secondary-color': '#f8f9fc',
        '--accent-color': '#F5A623',
        '--success-color': '#34C759',
        '--success-light': 'rgba(52, 199, 89, 0.08)',
        '--warning-color': '#FF9500',
        '--warning-light': 'rgba(255, 149, 0, 0.08)',
        '--danger-color': '#FF3B30',
        '--danger-light': 'rgba(255, 59, 48, 0.08)',
        '--text-primary': '#1a1a2e',
        '--text-secondary': '#6b7280',
        '--text-tertiary': '#9ca3af',
        '--bg-primary': '#ffffff',
        '--bg-secondary': '#f8f9fc',
        '--bg-tertiary': '#eef1f6',
        '--bg-glass': 'rgba(255, 255, 255, 0.72)',
        '--border-color': 'rgba(0, 0, 0, 0.06)',
        '--border-light': 'rgba(0, 0, 0, 0.03)',
        '--shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.04)',
        '--shadow-sm': '0 2px 8px rgba(0, 0, 0, 0.06)',
        '--shadow-md': '0 4px 16px rgba(0, 0, 0, 0.08)',
        '--shadow-lg': '0 12px 40px rgba(0, 0, 0, 0.12)',
        '--shadow-xl': '0 20px 60px rgba(0, 0, 0, 0.16)',
        '--shadow-glow': '0 4px 20px rgba(79, 142, 247, 0.2)',
        '--gradient-brand': 'linear-gradient(135deg, #4F8EF7, #6C63FF)',
        '--gradient-brand-text': 'linear-gradient(135deg, #4F8EF7, #8B5CF6)',
        '--gradient-orb1': 'rgba(79, 142, 247, 0.06)',
        '--gradient-orb2': 'rgba(139, 92, 246, 0.05)',
        '--gradient-titlebar': 'linear-gradient(90deg, transparent, rgba(79, 142, 247, 0.3), rgba(139, 92, 246, 0.2), transparent)',
        '--scrollbar-thumb': 'rgba(0, 0, 0, 0.12)',
        '--scrollbar-thumb-hover': 'rgba(0, 0, 0, 0.2)',
        '--chat-user-bg': 'linear-gradient(135deg, #4F8EF7, #6C63FF)',
        '--input-focus-glow': 'rgba(79, 142, 247, 0.25)',
        /* 扩展背景变量 */
        '--bg-card': '#ffffff',
        '--bg-elevated': '#ffffff',
        '--bg-hover': 'rgba(255, 255, 255, 0.85)',
        '--bg-glass-heavy': 'rgba(255, 255, 255, 0.95)',
        '--bg-glass-medium': 'rgba(255, 255, 255, 0.85)',
        '--bg-glass-light': 'rgba(255, 255, 255, 0.6)',
        '--bg-input': '#ffffff',
        '--text-on-brand': '#ffffff',
      }
    },
    'ocean-dark': {
      name: '深海暗夜',
      icon: '🌊',
      description: '深邃优雅，暗色护眼模式',
      vars: {
        '--primary-color': '#5BA8F7',
        '--primary-hover': '#4A96E0',
        '--primary-light': 'rgba(91, 168, 247, 0.12)',
        '--primary-glow': 'rgba(91, 168, 247, 0.3)',
        '--secondary-color': '#1e2433',
        '--accent-color': '#F5A623',
        '--success-color': '#4ADE80',
        '--success-light': 'rgba(74, 222, 128, 0.1)',
        '--warning-color': '#FBBF24',
        '--warning-light': 'rgba(251, 191, 36, 0.1)',
        '--danger-color': '#F87171',
        '--danger-light': 'rgba(248, 113, 113, 0.1)',
        '--text-primary': '#e8ecf4',
        '--text-secondary': '#94a3b8',
        '--text-tertiary': '#64748b',
        '--bg-primary': '#151922',
        '--bg-secondary': '#1a1f2e',
        '--bg-tertiary': '#232a3b',
        '--bg-glass': 'rgba(21, 25, 34, 0.82)',
        '--border-color': 'rgba(255, 255, 255, 0.06)',
        '--border-light': 'rgba(255, 255, 255, 0.03)',
        '--shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.2)',
        '--shadow-sm': '0 2px 8px rgba(0, 0, 0, 0.25)',
        '--shadow-md': '0 4px 16px rgba(0, 0, 0, 0.3)',
        '--shadow-lg': '0 12px 40px rgba(0, 0, 0, 0.35)',
        '--shadow-xl': '0 20px 60px rgba(0, 0, 0, 0.4)',
        '--shadow-glow': '0 4px 20px rgba(91, 168, 247, 0.25)',
        '--gradient-brand': 'linear-gradient(135deg, #5BA8F7, #7C6CFF)',
        '--gradient-brand-text': 'linear-gradient(135deg, #5BA8F7, #A78BFA)',
        '--gradient-orb1': 'rgba(91, 168, 247, 0.08)',
        '--gradient-orb2': 'rgba(124, 108, 255, 0.06)',
        '--gradient-titlebar': 'linear-gradient(90deg, transparent, rgba(91, 168, 247, 0.25), rgba(124, 108, 255, 0.15), transparent)',
        '--scrollbar-thumb': 'rgba(255, 255, 255, 0.1)',
        '--scrollbar-thumb-hover': 'rgba(255, 255, 255, 0.18)',
        '--chat-user-bg': 'linear-gradient(135deg, #5BA8F7, #7C6CFF)',
        '--input-focus-glow': 'rgba(91, 168, 247, 0.3)',
        /* 暗色主题扩展背景变量 */
        '--bg-card': '#1e2433',
        '--bg-elevated': '#1a1f2e',
        '--bg-hover': 'rgba(30, 36, 51, 0.9)',
        '--bg-glass-heavy': 'rgba(21, 25, 34, 0.95)',
        '--bg-glass-medium': 'rgba(26, 31, 46, 0.9)',
        '--bg-glass-light': 'rgba(30, 36, 51, 0.7)',
        '--bg-input': '#1e2433',
        '--text-on-brand': '#ffffff',
      }
    },
    'sunset-warm': {
      name: '暖阳橙',
      icon: '🌅',
      description: '温暖治愈，活力满满',
      vars: {
        '--primary-color': '#F47B5E',
        '--primary-hover': '#E0684B',
        '--primary-light': 'rgba(244, 123, 94, 0.08)',
        '--primary-glow': 'rgba(244, 123, 94, 0.25)',
        '--secondary-color': '#fdf6f2',
        '--accent-color': '#6C63FF',
        '--success-color': '#34C759',
        '--success-light': 'rgba(52, 199, 89, 0.08)',
        '--warning-color': '#FF9500',
        '--warning-light': 'rgba(255, 149, 0, 0.08)',
        '--danger-color': '#FF3B30',
        '--danger-light': 'rgba(255, 59, 48, 0.08)',
        '--text-primary': '#2d1f1a',
        '--text-secondary': '#8b7368',
        '--text-tertiary': '#b8a49a',
        '--bg-primary': '#ffffff',
        '--bg-secondary': '#fdf6f2',
        '--bg-tertiary': '#f7ece4',
        '--bg-glass': 'rgba(255, 255, 255, 0.72)',
        '--border-color': 'rgba(180, 120, 80, 0.08)',
        '--border-light': 'rgba(180, 120, 80, 0.04)',
        '--shadow-xs': '0 1px 2px rgba(120, 60, 20, 0.04)',
        '--shadow-sm': '0 2px 8px rgba(120, 60, 20, 0.06)',
        '--shadow-md': '0 4px 16px rgba(120, 60, 20, 0.07)',
        '--shadow-lg': '0 12px 40px rgba(120, 60, 20, 0.1)',
        '--shadow-xl': '0 20px 60px rgba(120, 60, 20, 0.14)',
        '--shadow-glow': '0 4px 20px rgba(244, 123, 94, 0.2)',
        '--gradient-brand': 'linear-gradient(135deg, #F47B5E, #F5A623)',
        '--gradient-brand-text': 'linear-gradient(135deg, #F47B5E, #E85D75)',
        '--gradient-orb1': 'rgba(244, 123, 94, 0.06)',
        '--gradient-orb2': 'rgba(245, 166, 35, 0.05)',
        '--gradient-titlebar': 'linear-gradient(90deg, transparent, rgba(244, 123, 94, 0.3), rgba(245, 166, 35, 0.2), transparent)',
        '--scrollbar-thumb': 'rgba(180, 120, 80, 0.12)',
        '--scrollbar-thumb-hover': 'rgba(180, 120, 80, 0.2)',
        '--chat-user-bg': 'linear-gradient(135deg, #F47B5E, #F5A623)',
        '--input-focus-glow': 'rgba(244, 123, 94, 0.25)',
        '--bg-card': '#ffffff',
        '--bg-elevated': '#ffffff',
        '--bg-hover': 'rgba(255, 255, 255, 0.85)',
        '--bg-glass-heavy': 'rgba(255, 255, 255, 0.95)',
        '--bg-glass-medium': 'rgba(255, 255, 255, 0.85)',
        '--bg-glass-light': 'rgba(255, 255, 255, 0.6)',
        '--bg-input': '#ffffff',
        '--text-on-brand': '#ffffff',
      }
    },
    'forest-green': {
      name: '森林绿',
      icon: '🌿',
      description: '自然舒适，沉浸专注',
      vars: {
        '--primary-color': '#3DA876',
        '--primary-hover': '#2E9670',
        '--primary-light': 'rgba(61, 168, 118, 0.08)',
        '--primary-glow': 'rgba(61, 168, 118, 0.25)',
        '--secondary-color': '#f2f7f4',
        '--accent-color': '#D4A843',
        '--success-color': '#34C759',
        '--success-light': 'rgba(52, 199, 89, 0.08)',
        '--warning-color': '#E6A23C',
        '--warning-light': 'rgba(230, 162, 60, 0.08)',
        '--danger-color': '#E85D5D',
        '--danger-light': 'rgba(232, 93, 93, 0.08)',
        '--text-primary': '#1a2e24',
        '--text-secondary': '#5a7a68',
        '--text-tertiary': '#8aab98',
        '--bg-primary': '#ffffff',
        '--bg-secondary': '#f2f7f4',
        '--bg-tertiary': '#e4efe8',
        '--bg-glass': 'rgba(255, 255, 255, 0.72)',
        '--border-color': 'rgba(30, 100, 60, 0.06)',
        '--border-light': 'rgba(30, 100, 60, 0.03)',
        '--shadow-xs': '0 1px 2px rgba(30, 80, 50, 0.04)',
        '--shadow-sm': '0 2px 8px rgba(30, 80, 50, 0.06)',
        '--shadow-md': '0 4px 16px rgba(30, 80, 50, 0.07)',
        '--shadow-lg': '0 12px 40px rgba(30, 80, 50, 0.1)',
        '--shadow-xl': '0 20px 60px rgba(30, 80, 50, 0.14)',
        '--shadow-glow': '0 4px 20px rgba(61, 168, 118, 0.2)',
        '--gradient-brand': 'linear-gradient(135deg, #3DA876, #2E9E6F)',
        '--gradient-brand-text': 'linear-gradient(135deg, #3DA876, #5BB89A)',
        '--gradient-orb1': 'rgba(61, 168, 118, 0.06)',
        '--gradient-orb2': 'rgba(46, 158, 111, 0.05)',
        '--gradient-titlebar': 'linear-gradient(90deg, transparent, rgba(61, 168, 118, 0.3), rgba(46, 158, 111, 0.2), transparent)',
        '--scrollbar-thumb': 'rgba(30, 100, 60, 0.12)',
        '--scrollbar-thumb-hover': 'rgba(30, 100, 60, 0.2)',
        '--chat-user-bg': 'linear-gradient(135deg, #3DA876, #2E9E6F)',
        '--input-focus-glow': 'rgba(61, 168, 118, 0.25)',
        '--bg-card': '#ffffff',
        '--bg-elevated': '#ffffff',
        '--bg-hover': 'rgba(255, 255, 255, 0.85)',
        '--bg-glass-heavy': 'rgba(255, 255, 255, 0.95)',
        '--bg-glass-medium': 'rgba(255, 255, 255, 0.85)',
        '--bg-glass-light': 'rgba(255, 255, 255, 0.6)',
        '--bg-input': '#ffffff',
        '--text-on-brand': '#ffffff',
      }
    },
    'lavender': {
      name: '薰衣紫',
      icon: '💜',
      description: '优雅浪漫，梦幻质感',
      vars: {
        '--primary-color': '#8B6CF7',
        '--primary-hover': '#7958E6',
        '--primary-light': 'rgba(139, 108, 247, 0.08)',
        '--primary-glow': 'rgba(139, 108, 247, 0.25)',
        '--secondary-color': '#f6f3fc',
        '--accent-color': '#F5A623',
        '--success-color': '#34C759',
        '--success-light': 'rgba(52, 199, 89, 0.08)',
        '--warning-color': '#FF9500',
        '--warning-light': 'rgba(255, 149, 0, 0.08)',
        '--danger-color': '#FF3B30',
        '--danger-light': 'rgba(255, 59, 48, 0.08)',
        '--text-primary': '#1f1a2e',
        '--text-secondary': '#726b8a',
        '--text-tertiary': '#a59cb8',
        '--bg-primary': '#ffffff',
        '--bg-secondary': '#f6f3fc',
        '--bg-tertiary': '#ede8f7',
        '--bg-glass': 'rgba(255, 255, 255, 0.72)',
        '--border-color': 'rgba(100, 60, 200, 0.06)',
        '--border-light': 'rgba(100, 60, 200, 0.03)',
        '--shadow-xs': '0 1px 2px rgba(80, 40, 160, 0.04)',
        '--shadow-sm': '0 2px 8px rgba(80, 40, 160, 0.06)',
        '--shadow-md': '0 4px 16px rgba(80, 40, 160, 0.07)',
        '--shadow-lg': '0 12px 40px rgba(80, 40, 160, 0.1)',
        '--shadow-xl': '0 20px 60px rgba(80, 40, 160, 0.14)',
        '--shadow-glow': '0 4px 20px rgba(139, 108, 247, 0.2)',
        '--gradient-brand': 'linear-gradient(135deg, #8B6CF7, #B06CF7)',
        '--gradient-brand-text': 'linear-gradient(135deg, #8B6CF7, #D06CF7)',
        '--gradient-orb1': 'rgba(139, 108, 247, 0.06)',
        '--gradient-orb2': 'rgba(176, 108, 247, 0.05)',
        '--gradient-titlebar': 'linear-gradient(90deg, transparent, rgba(139, 108, 247, 0.3), rgba(176, 108, 247, 0.2), transparent)',
        '--scrollbar-thumb': 'rgba(100, 60, 200, 0.12)',
        '--scrollbar-thumb-hover': 'rgba(100, 60, 200, 0.2)',
        '--chat-user-bg': 'linear-gradient(135deg, #8B6CF7, #B06CF7)',
        '--input-focus-glow': 'rgba(139, 108, 247, 0.25)',
        '--bg-card': '#ffffff',
        '--bg-elevated': '#ffffff',
        '--bg-hover': 'rgba(255, 255, 255, 0.85)',
        '--bg-glass-heavy': 'rgba(255, 255, 255, 0.95)',
        '--bg-glass-medium': 'rgba(255, 255, 255, 0.85)',
        '--bg-glass-light': 'rgba(255, 255, 255, 0.6)',
        '--bg-input': '#ffffff',
        '--text-on-brand': '#ffffff',
      }
    }
  };

  let currentTheme = DEFAULT_THEME;
  let onThemeChange = null;

  function init() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES[saved]) {
      currentTheme = saved;
    }
    apply(currentTheme, false);
  }

  function apply(themeId, animate = true) {
    const theme = THEMES[themeId];
    if (!theme) return;

    const root = document.documentElement;

    if (animate) {
      root.style.transition = 'background-color 0.4s ease, color 0.4s ease';
      setTimeout(() => { root.style.transition = ''; }, 500);
    }

    Object.entries(theme.vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    currentTheme = themeId;
    localStorage.setItem(STORAGE_KEY, themeId);

    // 通知外部
    if (onThemeChange) onThemeChange(themeId, theme);
  }

  function getTheme() {
    return currentTheme;
  }

  function getThemeInfo(themeId) {
    return THEMES[themeId || currentTheme];
  }

  function getAllThemes() {
    return Object.entries(THEMES).map(([id, t]) => ({
      id,
      name: t.name,
      icon: t.icon,
      description: t.description
    }));
  }

  function isDark() {
    return currentTheme === 'ocean-dark';
  }

  function setOnThemeChange(cb) {
    onThemeChange = cb;
  }

  return { init, apply, getTheme, getThemeInfo, getAllThemes, isDark, setOnThemeChange };
})();

// 自动初始化
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ThemeEngine.init);
  } else {
    ThemeEngine.init();
  }
}

window.ThemeEngine = ThemeEngine;
