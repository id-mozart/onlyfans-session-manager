/**
 * OnlyFans Bootstrap Preload Script (SAFE VERSION)
 * 
 * Receives session data via additionalArguments in webPreferences
 * Sets localStorage BEFORE OnlyFans page scripts execute
 * 
 * SECURITY: 
 * - Uses contextIsolation: true (safe!)
 * - No remote module (safe!)
 * - No global variables (safe!)
 * - Each BrowserView gets its OWN arguments (no race conditions!)
 */

console.log('[BOOTSTRAP PRELOAD] 🚀 Starting...');
console.log('[BOOTSTRAP PRELOAD] process.argv:', process.argv);

// Parse arguments from additionalArguments
// Format: ['electron', 'path/to/preload.js', '--xBc=...', '--platformUserId=...', '--userId=...']
const args = process.argv.slice(2); // Skip electron executable and preload path

// Extract values
let xBc = '';
let platformUserId = '';
let userId = '';

for (const arg of args) {
  if (arg.startsWith('--xBc=')) {
    xBc = arg.substring('--xBc='.length);
  } else if (arg.startsWith('--platformUserId=')) {
    platformUserId = arg.substring('--platformUserId='.length);
  } else if (arg.startsWith('--userId=')) {
    userId = arg.substring('--userId='.length);
  }
}

console.log('[BOOTSTRAP PRELOAD] Parsed arguments:');
console.log('[BOOTSTRAP PRELOAD] xBc:', xBc ? xBc.substring(0, 20) + '...' : 'MISSING');
console.log('[BOOTSTRAP PRELOAD] platformUserId:', platformUserId || 'MISSING');
console.log('[BOOTSTRAP PRELOAD] userId:', userId || 'MISSING');

// Validate required data
if (!xBc || !platformUserId || !userId) {
  console.error('[BOOTSTRAP PRELOAD] ❌ CRITICAL ERROR: Missing required arguments!');
  console.error('[BOOTSTRAP PRELOAD] This will cause authentication FAILURE!');
  console.error('[BOOTSTRAP PRELOAD] xBc:', xBc ? 'OK' : 'MISSING');
  console.error('[BOOTSTRAP PRELOAD] platformUserId:', platformUserId ? 'OK' : 'MISSING');
  console.error('[BOOTSTRAP PRELOAD] userId:', userId ? 'OK' : 'MISSING');
} else {
  try {
    // Set localStorage synchronously BEFORE OnlyFans page scripts execute
    console.log('[BOOTSTRAP PRELOAD] Setting localStorage...');
    
    localStorage.setItem('x-bc', xBc);
    localStorage.setItem('platformUserId', platformUserId);
    localStorage.setItem('userId', userId);
    
    console.log('[BOOTSTRAP PRELOAD] ✅ x-bc set:', xBc.substring(0, 20) + '...');
    console.log('[BOOTSTRAP PRELOAD] ✅ platformUserId set:', platformUserId);
    console.log('[BOOTSTRAP PRELOAD] ✅ userId set:', userId);
    
    // Verify localStorage was set correctly
    const verifyXBc = localStorage.getItem('x-bc');
    const verifyPlatformUserId = localStorage.getItem('platformUserId');
    const verifyUserId = localStorage.getItem('userId');
    
    if (verifyXBc && verifyPlatformUserId && verifyUserId) {
      console.log('[BOOTSTRAP PRELOAD] ✅ ✅ ✅ ALL VERIFIED - Ready for authentication!');
      console.log('[BOOTSTRAP PRELOAD] x-bc matches:', verifyXBc === xBc ? '✅' : '❌');
      console.log('[BOOTSTRAP PRELOAD] platformUserId matches:', verifyPlatformUserId === platformUserId ? '✅' : '❌');
      console.log('[BOOTSTRAP PRELOAD] userId matches:', verifyUserId === userId ? '✅' : '❌');
    } else {
      console.error('[BOOTSTRAP PRELOAD] ❌ VERIFICATION FAILED!');
      console.error('[BOOTSTRAP PRELOAD] x-bc:', verifyXBc ? 'OK' : 'MISSING');
      console.error('[BOOTSTRAP PRELOAD] platformUserId:', verifyPlatformUserId ? 'OK' : 'MISSING');
      console.error('[BOOTSTRAP PRELOAD] userId:', verifyUserId ? 'OK' : 'MISSING');
    }
  } catch (error) {
    console.error('[BOOTSTRAP PRELOAD] ❌ FATAL ERROR setting localStorage:', error);
    console.error('[BOOTSTRAP PRELOAD] Stack trace:', error.stack);
  }
}

console.log('[BOOTSTRAP PRELOAD] 🏁 Bootstrap complete!');
