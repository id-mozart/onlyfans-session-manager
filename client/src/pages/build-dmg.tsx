import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Apple, Download, Loader2, CheckCircle2, XCircle, Clock, ExternalLink, AlertCircle } from "lucide-react";

export default function BuildDMG() {
  const [version, setVersion] = useState("1.0.0");
  const [universal, setUniversal] = useState(true);
  const { toast } = useToast();

  // Query to check build status
  const { data: statusData, isLoading: statusLoading } = useQuery<any>({
    queryKey: ["/api/build/dmg/status"],
    refetchInterval: 5000, // Poll every 5 seconds
  });

  // Query to check download availability
  const { data: downloadData, isLoading: downloadLoading } = useQuery<any>({
    queryKey: ["/api/build/dmg/download"],
    refetchInterval: 10000, // Poll every 10 seconds
  });

  // Query to get GitHub Releases with DMG files
  const { data: releasesData, isLoading: releasesLoading } = useQuery<any>({
    queryKey: ["/api/build/dmg/releases"],
    refetchInterval: 30000, // Poll every 30 seconds
  });

  // Mutation to trigger build
  const triggerBuildMutation = useMutation({
    mutationFn: async (params: { version: string; universal: boolean }) => {
      const res = await apiRequest("POST", "/api/build/dmg/trigger", params);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Сборка запущена!",
        description: "Сборка .dmg файла началась. Это займёт ~5-10 минут.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/build/dmg/status"] });
    },
    onError: (error: any) => {
      const message = error?.message || "Не удалось запустить сборку";
      const isGitHubNotConnected = message.includes("GitHub not connected") || message.includes("GitHub integration not available");
      const isRepoNotDetected = message.includes("GitHub repository not detected");
      
      let description = message;
      if (isGitHubNotConnected) {
        description = "Подключите GitHub в разделе Integrations в Replit";
      } else if (isRepoNotDetected) {
        description = "Настройте GITHUB_REPO в переменных окружения. См. GITHUB_REPO_SETUP.md";
      }
      
      toast({
        title: "Ошибка",
        description,
        variant: "destructive",
      });
    },
  });

  const handleTriggerBuild = () => {
    triggerBuildMutation.mutate({ version, universal });
  };

  const latestRun = statusData;
  const isBuilding = latestRun?.status === "in_progress" || latestRun?.status === "queued";
  const buildSuccess = latestRun?.conclusion === "success";
  const buildFailed = latestRun?.conclusion === "failure" || latestRun?.conclusion === "cancelled";
  
  // Show fix instructions if build failed (likely due to cache error)
  const showFixInstructions = buildFailed && latestRun?.conclusion === "failure";

  const getStatusBadge = () => {
    if (!latestRun || latestRun.status === "no_builds") {
      return <Badge variant="secondary">Нет сборок</Badge>;
    }
    if (isBuilding) {
      return <Badge variant="default" className="flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Идёт сборка...
      </Badge>;
    }
    if (buildSuccess) {
      return <Badge variant="default" className="flex items-center gap-1 bg-green-600">
        <CheckCircle2 className="h-3 w-3" />
        Успешно
      </Badge>;
    }
    if (buildFailed) {
      return <Badge variant="destructive" className="flex items-center gap-1">
        <XCircle className="h-3 w-3" />
        Ошибка
      </Badge>;
    }
    return <Badge variant="secondary">
      <Clock className="h-3 w-3 mr-1" />
      {latestRun.status}
    </Badge>;
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return "N/A";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleString('ru-RU');
  };

  return (
    <div className="max-w-4xl mx-auto px-6 md:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Сборка macOS Installer (.dmg)</h1>
        <p className="text-muted-foreground">
          Автоматическая сборка .dmg файла через GitHub Actions на macOS runner
        </p>
      </div>

      {/* Build Configuration Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Apple className="h-5 w-5" />
            Настройки сборки
          </CardTitle>
          <CardDescription>
            Настройте параметры сборки и запустите процесс
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="version">Версия</Label>
            <Input
              id="version"
              data-testid="input-version"
              placeholder="1.0.0"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              disabled={triggerBuildMutation.isPending || isBuilding}
            />
            <p className="text-sm text-muted-foreground">
              Версия будет указана в имени файла и release
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="universal">Универсальная сборка</Label>
              <p className="text-sm text-muted-foreground">
                Сборка для Intel и Apple Silicon (занимает больше времени)
              </p>
            </div>
            <Switch
              id="universal"
              data-testid="switch-universal"
              checked={universal}
              onCheckedChange={setUniversal}
              disabled={triggerBuildMutation.isPending || isBuilding}
            />
          </div>

          <Button
            onClick={handleTriggerBuild}
            disabled={triggerBuildMutation.isPending || isBuilding || !version}
            className="w-full"
            size="lg"
            data-testid="button-trigger-build"
          >
            {triggerBuildMutation.isPending || isBuilding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isBuilding ? "Идёт сборка..." : "Запуск..."}
              </>
            ) : (
              <>
                <Apple className="mr-2 h-4 w-4" />
                Сгенерировать DMG
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Build Status Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Статус сборки</span>
            {getStatusBadge()}
          </CardTitle>
          <CardDescription>
            Последняя информация о сборке
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statusLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : latestRun && latestRun.status !== "no_builds" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Создано</p>
                  <p className="font-medium">{formatDate(latestRun.created_at)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Обновлено</p>
                  <p className="font-medium">{formatDate(latestRun.updated_at)}</p>
                </div>
              </div>

              {latestRun.html_url && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open(latestRun.html_url, "_blank")}
                  data-testid="button-view-github"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Посмотреть на GitHub
                </Button>
              )}

              {isBuilding && (
                <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <p className="text-sm text-blue-900 dark:text-blue-100 font-medium">
                    Сборка в процессе
                  </p>
                  <p className="text-sm text-blue-800 dark:text-blue-200 mt-1">
                    Обычно занимает 5-10 минут. Страница обновляется автоматически.
                  </p>
                </div>
              )}

              {buildFailed && (
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <p className="text-sm text-red-900 dark:text-red-100 font-medium">
                    Сборка завершилась с ошибкой
                  </p>
                  <p className="text-sm text-red-800 dark:text-red-200 mt-1">
                    Проверьте логи на GitHub для получения деталей.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              Нет активных сборок. Запустите сборку выше.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Download Card - GitHub Releases */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Скачать DMG
          </CardTitle>
          <CardDescription>
            Доступные релизы с .dmg файлами для скачивания
          </CardDescription>
        </CardHeader>
        <CardContent>
          {releasesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : releasesData?.available ? (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <p className="text-sm font-medium text-green-900 dark:text-green-100">
                  Найдено {releasesData.count} {releasesData.count === 1 ? 'релиз' : 'релиза'} с DMG файлами
                </p>
              </div>

              {/* List of Releases */}
              <div className="space-y-3">
                {releasesData.releases.map((release: any) => (
                  <Card key={release.id} className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            {release.name || release.tag_name}
                            {release.prerelease && (
                              <Badge variant="secondary" className="text-xs">Pre-release</Badge>
                            )}
                            {release.draft && (
                              <Badge variant="secondary" className="text-xs">Draft</Badge>
                            )}
                          </CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {formatDate(release.published_at)}
                          </CardDescription>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => window.open(release.html_url, "_blank")}
                          data-testid={`button-view-release-${release.id}`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {release.assets.map((asset: any) => (
                        <div
                          key={asset.id}
                          className="flex items-center justify-between gap-4 p-3 rounded-lg bg-background border hover-elevate"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{asset.name}</p>
                            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                              <span>{formatFileSize(asset.size)}</span>
                              <span>↓ {asset.download_count}</span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => window.open(asset.browser_download_url, "_blank")}
                            data-testid={`button-download-${asset.id}`}
                          >
                            <Download className="mr-2 h-3 w-3" />
                            Скачать
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Link to all releases */}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(`${releasesData.repo_url}/releases`, "_blank")}
                data-testid="button-view-all-releases"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Все релизы на GitHub
              </Button>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                {releasesData?.message || "Нет доступных релизов с DMG файлами"}
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Запустите сборку выше. После успешной сборки создайте Release на GitHub с DMG файлом.
              </p>
              <Button
                variant="outline"
                onClick={() => window.open(`${releasesData?.repo_url || 'https://github.com'}/releases/new`, "_blank")}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Создать Release
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error Explanation */}
      {showFixInstructions && (
        <Card className="mt-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950">
          <CardHeader>
            <CardTitle className="text-red-900 dark:text-red-100 flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Как исправить ошибку "Not Found"
            </CardTitle>
            <CardDescription className="text-red-700 dark:text-red-300">
              Сборка не запустилась, потому что workflow файл содержит ошибку
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-white dark:bg-gray-900 border border-red-200 dark:border-red-700 rounded-lg p-4">
              <p className="text-sm font-medium text-red-900 dark:text-red-100 mb-3">
                Проблема: В workflow файле указан путь к <code className="bg-red-100 dark:bg-red-900 px-1 rounded">package-lock.json</code>, но проект еще не загружен в GitHub
              </p>
              <p className="text-sm text-red-800 dark:text-red-200 mb-4">
                Решение: Обновите workflow файл - уберите строки с кешированием
              </p>
            </div>

            <div className="bg-white dark:bg-gray-900 border border-red-200 dark:border-red-700 rounded-lg p-4 space-y-3">
              <p className="text-sm font-medium text-red-900 dark:text-red-100">
                Пошаговая инструкция:
              </p>
              <ol className="list-decimal list-inside space-y-2 ml-2 text-sm text-red-800 dark:text-red-200">
                <li>
                  Откройте workflow файл на GitHub:{' '}
                  <button
                    className="text-red-600 dark:text-red-400 underline hover:no-underline"
                    onClick={() => window.open('https://github.com/id-mozart/onlyfans-session-manager/edit/main/.github/workflows/build-dmg.yml', '_blank')}
                  >
                    открыть в GitHub <ExternalLink className="ml-1 h-3 w-3 inline" />
                  </button>
                </li>
                <li>Найдите эти строки (примерно на 27-29 линии):
                  <pre className="bg-red-100 dark:bg-red-900 p-2 rounded mt-1 text-xs overflow-x-auto">
{`      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: 'desktop/package-lock.json'`}
                  </pre>
                </li>
                <li>Удалите последние 2 строки (cache и cache-dependency-path):
                  <pre className="bg-green-100 dark:bg-green-900 p-2 rounded mt-1 text-xs overflow-x-auto">
{`      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'`}
                  </pre>
                </li>
                <li>Нажмите "Commit changes" в правом верхнем углу</li>
                <li>Вернитесь сюда и нажмите "Сгенерировать DMG" снова</li>
              </ol>
            </div>

            <Button
              variant="default"
              size="lg"
              className="w-full bg-red-600 hover:bg-red-700 text-white"
              onClick={() => window.open('https://github.com/id-mozart/onlyfans-session-manager/edit/main/.github/workflows/build-dmg.yml', '_blank')}
              data-testid="button-fix-workflow"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Открыть workflow для редактирования
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
