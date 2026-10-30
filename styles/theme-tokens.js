/**
 * OneVue Unified Design System Tokens
 * Source of truth for all UI styling, themes, and canvas rendering.
 */
(function () {
  'use strict';

  const TOKENS = {
    // 5 Curated Themes
    themes: {
      sapphire: {
        id: 'sapphire',
        name: 'Midnight Sapphire',
        subtitle: '& Platinum',
        mode: 'dark',
        colors: {
          bg0: '#050A1A',
          bg1: '#0D1836',
          bg2: '#14224A',
          primary: '#3558F0',
          soft: '#9DBBFF',
          metal: '#E7EAF3',
          accent: '#D8B873',
          text1: '#E7EAF3',
          text2: '#A9B2C9',
          text3: '#6C7798',
          onPrimary: '#FFFFFF',
          glass: 'rgba(231,234,243,0.055)',
          glassHi: 'rgba(231,234,243,0.085)',
          line: 'rgba(231,234,243,0.12)',
          lineHi: 'rgba(231,234,243,0.24)',
          shade: 'rgba(1,3,12,0.6)',
          sheen: 'rgba(255,255,255,0.07)',
          danger: '#EF4444',
          success: '#10B981',
        },
      },
      obsidian: {
        id: 'obsidian',
        name: 'Obsidian',
        subtitle: '& Champagne Gold',
        mode: 'dark',
        colors: {
          bg0: '#0A0A0F',
          bg1: '#15151D',
          bg2: '#1E1E29',
          primary: '#C9A961',
          soft: '#EBDDB0',
          metal: '#F6F2E9',
          accent: '#C9A961',
          text1: '#F6F2E9',
          text2: '#B8B2A3',
          text3: '#7D786C',
          onPrimary: '#14120C',
          glass: 'rgba(246,242,233,0.05)',
          glassHi: 'rgba(246,242,233,0.08)',
          line: 'rgba(246,242,233,0.11)',
          lineHi: 'rgba(235,221,176,0.26)',
          shade: 'rgba(0,0,0,0.62)',
          sheen: 'rgba(255,248,230,0.07)',
          danger: '#F87171',
          success: '#34D399',
        },
      },
      emerald: {
        id: 'emerald',
        name: 'Emerald Royale',
        subtitle: 'Deep green & brass',
        mode: 'dark',
        colors: {
          bg0: '#04100D',
          bg1: '#0A2820',
          bg2: '#10372C',
          primary: '#1E9B74',
          soft: '#7FE0BE',
          metal: '#F4F1E8',
          accent: '#D4B26A',
          text1: '#F4F1E8',
          text2: '#A9BDB4',
          text3: '#6B8379',
          onPrimary: '#03140F',
          glass: 'rgba(244,241,232,0.05)',
          glassHi: 'rgba(244,241,232,0.08)',
          line: 'rgba(244,241,232,0.12)',
          lineHi: 'rgba(127,224,190,0.26)',
          shade: 'rgba(0,6,4,0.6)',
          sheen: 'rgba(240,255,248,0.07)',
          danger: '#EF4444',
          success: '#1E9B74',
        },
      },
      plum: {
        id: 'plum',
        name: 'Imperial Plum',
        subtitle: '& Rose Gold',
        mode: 'dark',
        colors: {
          bg0: '#110819',
          bg1: '#26123B',
          bg2: '#341A4F',
          primary: '#7A3FC0',
          soft: '#C9A6F0',
          metal: '#F5EEF8',
          accent: '#DDA58F',
          text1: '#F5EEF8',
          text2: '#B9A9C9',
          text3: '#7E6F92',
          onPrimary: '#FFFFFF',
          glass: 'rgba(245,238,248,0.055)',
          glassHi: 'rgba(245,238,248,0.085)',
          line: 'rgba(245,238,248,0.12)',
          lineHi: 'rgba(201,166,240,0.28)',
          shade: 'rgba(6,0,12,0.6)',
          sheen: 'rgba(255,240,250,0.07)',
          danger: '#F87171',
          success: '#34D399',
        },
      },
      ivory: {
        id: 'ivory',
        name: 'Ivory Light Luxe',
        subtitle: 'Frosted white glass',
        mode: 'light',
        colors: {
          bg0: '#F8F5EE',
          bg1: '#FFFFFF',
          bg2: '#EFEADF',
          primary: '#14213D',
          soft: '#3C4F7C',
          metal: '#A8844A',
          accent: '#A8844A',
          text1: '#14213D',
          text2: '#5B6478',
          text3: '#8A91A3',
          onPrimary: '#FFFFFF',
          glass: 'rgba(255,255,255,0.58)',
          glassHi: 'rgba(255,255,255,0.78)',
          line: 'rgba(20,33,61,0.10)',
          lineHi: 'rgba(168,132,74,0.38)',
          shade: 'rgba(60,48,20,0.16)',
          sheen: 'rgba(255,255,255,0.7)',
          danger: '#9A3B2E',
          success: '#1E6B52',
        },
      },
    },

    // Typography
    typography: {
      fonts: {
        display: "'Cormorant Garamond', Georgia, serif",
        sans: "'Inter', ui-sans-serif, system-ui, sans-serif",
        mono: "ui-monospace, 'SF Mono', Menlo, monospace",
      },
      sizes: {
        display: 'clamp(48px, 9vw, 112px)',
        section: 'clamp(36px, 5.4vw, 64px)',
        card: '28px',
        subheading: '20px',
        body: '16px',
        bodySm: '14px',
        caption: '12.5px',
        micro: '11px',
      },
      lineHeights: {
        tight: 0.95,
        heading: 1.04,
        body: 1.55,
      },
      weights: {
        regular: 400,
        medium: 500,
        semibold: 600,
      },
    },

    // Spacing
    spacing: {
      xxs: '4px',
      xs: '8px',
      sm: '12px',
      md: '16px',
      lg: '20px',
      xl: '24px',
      xxl: '32px',
      sectionSm: '48px',
      sectionMd: '80px',
      sectionLg: '120px',
    },

    // Border Radii
    radii: {
      xs: '6px',
      sm: '10px',
      md: '14px',
      lg: '18px',
      card: '22px',
      modal: '26px',
      pill: '999px',
    },

    // Box Shadows
    shadows: {
      glass: 'inset 0 1px 0 var(--sheen), 0 1px 2px var(--shade), 0 12px 32px -12px var(--shade), 0 40px 80px -40px var(--shade)',
      button: 'inset 0 1px 0 rgba(255,255,255,0.22), 0 10px 28px -10px color-mix(in oklab, var(--primary) 80%, transparent)',
      buttonHover: 'inset 0 1px 0 rgba(255,255,255,0.26), 0 16px 36px -12px color-mix(in oklab, var(--primary) 90%, transparent)',
      glow: '0 0 24px -4px color-mix(in oklab, var(--soft) 40%, transparent)',
    },

    // Transitions & Timings
    transitions: {
      themeFade: '700ms cubic-bezier(0.4, 0, 0.2, 1)',
      lift: 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), border-color 0.3s, box-shadow 0.4s',
      button: 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.25s, background-color 0.25s',
      quick: '0.15s ease',
    },

    // Responsive Breakpoints
    breakpoints: {
      mobileMax: 760,
      tabletMax: 860,
      desktopMin: 861,
      wrapMax: 1200,
    },

    /**
     * Helper to retrieve currently applied theme token values
     */
    getActiveTokens() {
      const activeThemeId = document.documentElement.getAttribute('data-theme') || 'sapphire';
      return TOKENS.themes[activeThemeId] || TOKENS.themes.sapphire;
    },
  };

  window.OV_THEME_TOKENS = TOKENS;
  if (window.OV) {
    window.OV.tokens = TOKENS;
  }
})();
