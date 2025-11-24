/**
 * OnlyFans Bootstrap Preload Script
 * 
 * This preload script runs BEFORE any OnlyFans page scripts execute.
 * It sets localStorage (x-bc, platformUserId, userId) synchronously so that
 * the very first API request includes the correct fingerprint.
 * 
 * CRITICAL TIMING:
 * - Preload executes AFTER document created but BEFORE page scripts load
 * - localStorage set here is available to OnlyFans scripts immediately
 * - No race condition because this runs in same event loop before first network request
 */

const { remote } = require('electron');

console.log('[BOOTSTRAP] 🚀 OnlyFans preload script executing...');

try {
  // Read bootstrap data from global variable set by main process
  // This is safer than IPC because it's synchronous and partition-specific
  const bootstrapData = remote.getGlobal('onlyFansBootstrapData');
  
  if (!bootstrapData) {
    console.error('[BOOTSTRAP] ❌ No bootstrap data in global - localStorage NOT set!');
    console.error('[BOOTSTRAP] This will cause authentication failure!');
    return;
  }
  
  console.log('[BOOTSTRAP] ✅ Found bootstrap data:', {
    partitionName: bootstrapData.partitionName,
    hasXBc: !!bootstrapData.xBc,
    hasPlatformUserId: !!bootstrapData.platformUserId,
    hasUserId: !!bootstrapData.userId
  });
  
  // Set localStorage BEFORE OnlyFans scripts execute
  if (bootstrapData.xBc) {
    localStorage.setItem('x-bc', bootstrapData.xBc);
    console.log('[BOOTSTRAP] ✅ x-bc set:', bootstrapData.xBc.substring(0, 20) + '...');
  } else {
    console.error('[BOOTSTRAP] ❌ x-bc missing in bootstrap data!');
  }
  
  if (bootstrapData.platformUserId) {
    localStorage.setItem('platformUserId', bootstrapData.platformUserId);
    console.log('[BOOTSTRAP] ✅ platformUserId set:', bootstrapData.platformUserId);
  } else {
    console.error('[BOOTSTRAP] ❌ platformUserId missing in bootstrap data!');
  }
  
  if (bootstrapData.userId) {
    localStorage.setItem('userId', bootstrapData.userId);
    console.log('[BOOTSTRAP] ✅ userId set:', bootstrapData.userId);
  } else {
    console.error('[BOOTSTRAP] ❌ userId missing in bootstrap data!');
  }
  
  console.log('[BOOTSTRAP] 🎉 localStorage seeded successfully BEFORE OnlyFans scripts!');
  
  // Verify localStorage was set
  const verifyXBc = localStorage.getItem('x-bc');
  const verifyPlatformUserId = localStorage.getItem('platformUserId');
  const verifyUserId = localStorage.getItem('userId');
  
  console.log('[BOOTSTRAP] 🔍 Final verification:', {
    xBc: verifyXBc ? verifyXBc.substring(0, 20) + '... ✅' : '❌ NOT SET',
    platformUserId: verifyPlatformUserId ? verifyPlatformUserId + ' ✅' : '❌ NOT SET',
    userId: verifyUserId ? verifyUserId + ' ✅' : '❌ NOT SET'
  });
  
  if (!verifyXBc || !verifyPlatformUserId || !verifyUserId) {
    console.error('[BOOTSTRAP] ❌ CRITICAL: Some localStorage values NOT set!');
    console.error('[BOOTSTRAP] Authentication will FAIL!');
  } else {
    console.log('[BOOTSTRAP] ✅ ✅ ✅ ALL CHECKS PASSED - Ready for authentication!');
  }
  
} catch (error) {
  console.error('[BOOTSTRAP] ❌ FATAL ERROR seeding localStorage:', error);
  console.error('[BOOTSTRAP] Stack trace:', error.stack);
}