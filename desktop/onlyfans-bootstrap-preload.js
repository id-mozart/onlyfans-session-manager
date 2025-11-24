/**
 * OnlyFans Bootstrap Preload Script
 * 
 * This preload script runs BEFORE any OnlyFans page scripts execute.
 * It sets localStorage (x-bc, platformUserId, userId) synchronously so that
 * the very first API request includes the correct fingerprint.
 * 
 * Without this, OnlyFans frontend reads empty localStorage and doesn't send
 * x-bc in AJAX requests, causing isAuth: false responses.
 */

const { ipcRenderer } = require('electron');

console.log('[BOOTSTRAP] OnlyFans preload script executing...');

try {
  // Synchronously fetch bootstrap data from main process
  const bootstrapData = ipcRenderer.sendSync('of:get-bootstrap-data');
  
  if (!bootstrapData) {
    console.warn('[BOOTSTRAP] No bootstrap data available for this partition');
    return;
  }
  
  console.log('[BOOTSTRAP] Received bootstrap data:', {
    hasXBc: !!bootstrapData.xBc,
    hasPlatformUserId: !!bootstrapData.platformUserId,
    hasUserId: !!bootstrapData.userId
  });
  
  // Set localStorage BEFORE OnlyFans scripts execute
  if (bootstrapData.xBc) {
    localStorage.setItem('x-bc', bootstrapData.xBc);
    console.log('[BOOTSTRAP] ✅ x-bc set in localStorage');
  }
  
  if (bootstrapData.platformUserId) {
    localStorage.setItem('platformUserId', bootstrapData.platformUserId);
    console.log('[BOOTSTRAP] ✅ platformUserId set in localStorage');
  }
  
  if (bootstrapData.userId) {
    localStorage.setItem('userId', bootstrapData.userId);
    console.log('[BOOTSTRAP] ✅ userId set in localStorage');
  }
  
  console.log('[BOOTSTRAP] ✅ localStorage seeded successfully');
  
  // Verify localStorage was set
  const verifyXBc = localStorage.getItem('x-bc');
  const verifyUserId = localStorage.getItem('userId');
  console.log('[BOOTSTRAP] Verification:', {
    xBc: verifyXBc ? verifyXBc.substring(0, 20) + '...' : 'NOT SET',
    userId: verifyUserId || 'NOT SET'
  });
  
} catch (error) {
  console.error('[BOOTSTRAP] ❌ Error seeding localStorage:', error);
}