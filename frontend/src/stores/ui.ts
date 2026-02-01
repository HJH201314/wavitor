import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUIStore = defineStore('ui', () => {
  // Mobile sidebar state
  const showMobileSidebar = ref(false);
  
  // Bottom navigation visibility setting (user preference)
  const showBottomNav = ref(true);
  
  // Bottom sheet (workspace list) state
  const showBottomSheet = ref(false);
  
  // Load settings from localStorage
  const loadSettings = () => {
    const saved = localStorage.getItem('wavitor_ui_settings');
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        showBottomNav.value = settings.showBottomNav ?? true;
      } catch (error) {
        console.error('Failed to load UI settings:', error);
      }
    }
  };
  
  // Save settings to localStorage
  const saveSettings = () => {
    const settings = {
      showBottomNav: showBottomNav.value,
    };
    localStorage.setItem('wavitor_ui_settings', JSON.stringify(settings));
  };
  
  // Toggle mobile sidebar
  const toggleMobileSidebar = () => {
    showMobileSidebar.value = !showMobileSidebar.value;
  };
  
  // Close mobile sidebar
  const closeMobileSidebar = () => {
    showMobileSidebar.value = false;
  };
  
  // Toggle bottom sheet
  const toggleBottomSheet = () => {
    showBottomSheet.value = !showBottomSheet.value;
  };
  
  // Open bottom sheet
  const openBottomSheet = () => {
    showBottomSheet.value = true;
  };
  
  // Close bottom sheet
  const closeBottomSheet = () => {
    showBottomSheet.value = false;
  };
  
  // Toggle bottom nav visibility setting
  const toggleBottomNav = () => {
    showBottomNav.value = !showBottomNav.value;
    saveSettings();
  };
  
  // Initialize
  loadSettings();
  
  return {
    showMobileSidebar,
    showBottomNav,
    showBottomSheet,
    toggleMobileSidebar,
    closeMobileSidebar,
    toggleBottomSheet,
    openBottomSheet,
    closeBottomSheet,
    toggleBottomNav,
  };
});
