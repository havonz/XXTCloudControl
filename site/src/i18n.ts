export const siteLocaleOrder = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja-JP',
  'ko-KR',
  'vi-VN',
  'es-ES',
  'pt-BR',
  'ru-RU',
  'fr-FR',
  'de-DE'
] as const;

export type SiteLocale = (typeof siteLocaleOrder)[number];

export const siteLocaleMeta: Record<SiteLocale, { nativeLabel: string; slug: string }> = {
  'zh-CN': { nativeLabel: '简体中文', slug: '' },
  'zh-TW': { nativeLabel: '繁體中文', slug: 'zh-tw' },
  'en-US': { nativeLabel: 'English', slug: 'en' },
  'ja-JP': { nativeLabel: '日本語', slug: 'ja' },
  'ko-KR': { nativeLabel: '한국어', slug: 'ko' },
  'vi-VN': { nativeLabel: 'Tiếng Việt', slug: 'vi' },
  'es-ES': { nativeLabel: 'Español', slug: 'es' },
  'pt-BR': { nativeLabel: 'Português (Brasil)', slug: 'pt-br' },
  'ru-RU': { nativeLabel: 'Русский', slug: 'ru' },
  'fr-FR': { nativeLabel: 'Français', slug: 'fr' },
  'de-DE': { nativeLabel: 'Deutsch', slug: 'de' }
};

export const siteLocaleBySlug = Object.fromEntries(
  siteLocaleOrder
    .filter((locale) => siteLocaleMeta[locale].slug)
    .map((locale) => [siteLocaleMeta[locale].slug, locale])
) as Record<string, SiteLocale>;

type GuideItem = {
  title: string;
  body: string;
};

export type ReleaseCopy = {
  pageTitle: string;
  pageDescription: string;
  heroTitle: string;
  heroSubtitle: string;
  versionLabel: string;
  releaseLabel: string;
  releaseLink: string;
  historyBtn: string;
  docsBtn: string;
  languageNavLabel: string;
  downloadTitle: string;
  downloadSubtitle: string;
  screenshotAlt: string;
  fileLabel: string;
  shaLabel: string;
  copyBtn: string;
  copiedBtn: string;
  copyManuallyPrompt: string;
  downloadBtn: string;
  noAssets: string;
  quickStartTitle: string;
  quickStartSubtitle: string;
  guideItems: GuideItem[];
};

export const releaseCopy: Record<SiteLocale, ReleaseCopy> = {
  'zh-CN': {
    pageTitle: 'XXTCloudControl 下载',
    pageDescription: 'XXTCloudControl 官方发布下载页，自动跟随最新发布更新。',
    heroTitle: 'XXTCloudControl',
    heroSubtitle: 'XXTCloudControl 是 XXTouch 云控服务端，支持 Windows、macOS 和 Linux 部署。',
    versionLabel: '当前最新版本',
    releaseLabel: '发布详情',
    releaseLink: 'GitHub 发布',
    historyBtn: '历史版本',
    docsBtn: '查看完整文档',
    languageNavLabel: '选择语言',
    downloadTitle: '最新版下载',
    downloadSubtitle: '按系统选择安装包',
    screenshotAlt: 'XXTCloudControl 界面截图',
    fileLabel: '文件名',
    shaLabel: 'SHA256',
    copyBtn: '复制',
    copiedBtn: '已复制',
    copyManuallyPrompt: '请手动复制：',
    downloadBtn: '立即下载',
    noAssets: '暂未获取到可下载资产，请稍后重试。',
    quickStartTitle: '软件说明（精简）',
    quickStartSubtitle: '详细操作与高级配置请查看完整文档。',
    guideItems: [
      { title: 'Windows', body: '解压后运行 xxtcloudserver-windows-amd64.exe 或 arm64 版本，浏览器访问 http://<服务器地址>:46980。' },
      { title: 'macOS', body: '解压后执行 xxtcloudserver-darwin-arm64 或 amd64 二进制，并按需用 -set-password 初始化密码。' },
      { title: 'Linux', body: '解压后执行 xxtcloudserver-linux-amd64 或 arm64，建议配合 systemd/supervisor 常驻运行。' },
      { title: 'Docker', body: '支持 Docker Hub 与 GHCR，可直接 docker run 或使用仓库内 docker-compose.yml 部署。' }
    ]
  },
  'zh-TW': {
    pageTitle: 'XXTCloudControl 下載',
    pageDescription: 'XXTCloudControl 官方版本下載頁，會自動隨最新版本更新。',
    heroTitle: 'XXTCloudControl',
    heroSubtitle: 'XXTCloudControl 是 XXTouch 雲端控制伺服器，支援 Windows、macOS 與 Linux 部署。',
    versionLabel: '目前最新版本',
    releaseLabel: '版本詳情',
    releaseLink: 'GitHub 發布',
    historyBtn: '歷史版本',
    docsBtn: '查看完整文件',
    languageNavLabel: '選擇語言',
    downloadTitle: '最新版本下載',
    downloadSubtitle: '依作業系統選擇安裝套件',
    screenshotAlt: 'XXTCloudControl 介面截圖',
    fileLabel: '檔案名稱',
    shaLabel: 'SHA256',
    copyBtn: '複製',
    copiedBtn: '已複製',
    copyManuallyPrompt: '請手動複製：',
    downloadBtn: '立即下載',
    noAssets: '目前沒有可下載的檔案，請稍後再試。',
    quickStartTitle: '軟體說明（精簡）',
    quickStartSubtitle: '完整操作方式與進階設定請參閱完整文件。',
    guideItems: [
      { title: 'Windows', body: '解壓縮後執行 xxtcloudserver-windows-amd64.exe 或 arm64 版本，再以瀏覽器開啟 http://<伺服器位址>:46980。' },
      { title: 'macOS', body: '解壓縮後執行 xxtcloudserver-darwin-arm64 或 amd64，並在需要時使用 -set-password 初始化密碼。' },
      { title: 'Linux', body: '解壓縮後執行 xxtcloudserver-linux-amd64 或 arm64，建議搭配 systemd/supervisor 持續執行。' },
      { title: 'Docker', body: '支援 Docker Hub 與 GHCR，可直接使用 docker run 或倉庫內的 docker-compose.yml 部署。' }
    ]
  },
  'en-US': {
    pageTitle: 'XXTCloudControl Downloads',
    pageDescription: 'Official XXTCloudControl release page, automatically updated with the latest release.',
    heroTitle: 'XXTCloudControl',
    heroSubtitle: 'XXTCloudControl is the XXTouch cloud control server and supports deployment on Windows, macOS, and Linux.',
    versionLabel: 'Latest Version',
    releaseLabel: 'Release Details',
    releaseLink: 'GitHub Release',
    historyBtn: 'Release History',
    docsBtn: 'Full Documentation',
    languageNavLabel: 'Choose language',
    downloadTitle: 'Latest Downloads',
    downloadSubtitle: 'Choose an installer for your operating system.',
    screenshotAlt: 'XXTCloudControl interface screenshot',
    fileLabel: 'File Name',
    shaLabel: 'SHA256',
    copyBtn: 'Copy',
    copiedBtn: 'Copied',
    copyManuallyPrompt: 'Copy manually:',
    downloadBtn: 'Download',
    noAssets: 'No release assets are available yet. Please try again later.',
    quickStartTitle: 'Quick Software Guide',
    quickStartSubtitle: 'See the full documentation for complete usage and advanced configuration.',
    guideItems: [
      { title: 'Windows', body: 'Extract and run xxtcloudserver-windows-amd64.exe or the arm64 build, then open http://<server-host>:46980.' },
      { title: 'macOS', body: 'Extract and run the xxtcloudserver-darwin-arm64 or amd64 binary, then initialize the password with -set-password when needed.' },
      { title: 'Linux', body: 'Extract and run xxtcloudserver-linux-amd64 or arm64. Use systemd/supervisor to keep it running.' },
      { title: 'Docker', body: 'Images are available from Docker Hub and GHCR. Deploy with docker run or the repository docker-compose.yml.' }
    ]
  },
  'ja-JP': {
    pageTitle: 'XXTCloudControl ダウンロード',
    pageDescription: '最新リリースに合わせて自動更新される XXTCloudControl 公式ダウンロードページです。',
    heroTitle: 'XXTCloudControl',
    heroSubtitle: 'XXTCloudControl は XXTouch のクラウド制御サーバーで、Windows、macOS、Linux への導入に対応しています。',
    versionLabel: '最新バージョン',
    releaseLabel: 'リリース詳細',
    releaseLink: 'GitHub リリース',
    historyBtn: 'リリース履歴',
    docsBtn: '完全なドキュメント',
    languageNavLabel: '言語を選択',
    downloadTitle: '最新版をダウンロード',
    downloadSubtitle: 'お使いの OS に合ったパッケージを選択してください。',
    screenshotAlt: 'XXTCloudControl の画面',
    fileLabel: 'ファイル名',
    shaLabel: 'SHA256',
    copyBtn: 'コピー',
    copiedBtn: 'コピー済み',
    copyManuallyPrompt: '手動でコピーしてください：',
    downloadBtn: 'ダウンロード',
    noAssets: 'ダウンロード可能なファイルがまだありません。しばらくしてから再度お試しください。',
    quickStartTitle: 'ソフトウェアの簡易ガイド',
    quickStartSubtitle: '詳しい操作方法と高度な設定は完全なドキュメントをご覧ください。',
    guideItems: [
      { title: 'Windows', body: '展開後、xxtcloudserver-windows-amd64.exe または arm64 版を実行し、http://<サーバーアドレス>:46980 を開きます。' },
      { title: 'macOS', body: '展開後、xxtcloudserver-darwin-arm64 または amd64 を実行し、必要に応じて -set-password でパスワードを初期化します。' },
      { title: 'Linux', body: '展開後、xxtcloudserver-linux-amd64 または arm64 を実行します。常時稼働には systemd/supervisor の利用を推奨します。' },
      { title: 'Docker', body: 'Docker Hub と GHCR に対応しています。docker run またはリポジトリ内の docker-compose.yml でデプロイできます。' }
    ]
  },
  'ko-KR': {
    pageTitle: 'XXTCloudControl 다운로드',
    pageDescription: '최신 릴리스에 맞춰 자동으로 업데이트되는 XXTCloudControl 공식 다운로드 페이지입니다.',
    heroTitle: 'XXTCloudControl',
    heroSubtitle: 'XXTCloudControl은 XXTouch 클라우드 제어 서버이며 Windows, macOS, Linux에 배포할 수 있습니다.',
    versionLabel: '최신 버전',
    releaseLabel: '릴리스 정보',
    releaseLink: 'GitHub 릴리스',
    historyBtn: '릴리스 기록',
    docsBtn: '전체 문서',
    languageNavLabel: '언어 선택',
    downloadTitle: '최신 버전 다운로드',
    downloadSubtitle: '운영 체제에 맞는 패키지를 선택하세요.',
    screenshotAlt: 'XXTCloudControl 인터페이스 화면',
    fileLabel: '파일 이름',
    shaLabel: 'SHA256',
    copyBtn: '복사',
    copiedBtn: '복사됨',
    copyManuallyPrompt: '직접 복사하세요:',
    downloadBtn: '다운로드',
    noAssets: '아직 다운로드할 수 있는 파일이 없습니다. 잠시 후 다시 시도하세요.',
    quickStartTitle: '소프트웨어 빠른 안내',
    quickStartSubtitle: '전체 사용법과 고급 설정은 전체 문서를 확인하세요.',
    guideItems: [
      { title: 'Windows', body: '압축을 푼 뒤 xxtcloudserver-windows-amd64.exe 또는 arm64 버전을 실행하고 http://<서버-주소>:46980을 여세요.' },
      { title: 'macOS', body: '압축을 푼 뒤 xxtcloudserver-darwin-arm64 또는 amd64를 실행하고 필요하면 -set-password로 암호를 초기화하세요.' },
      { title: 'Linux', body: '압축을 푼 뒤 xxtcloudserver-linux-amd64 또는 arm64를 실행하세요. 지속 실행에는 systemd/supervisor 사용을 권장합니다.' },
      { title: 'Docker', body: 'Docker Hub와 GHCR 이미지를 지원합니다. docker run 또는 저장소의 docker-compose.yml로 배포할 수 있습니다.' }
    ]
  },
  'vi-VN': {
    pageTitle: 'Tải xuống XXTCloudControl',
    pageDescription: 'Trang tải xuống chính thức của XXTCloudControl, tự động cập nhật theo bản phát hành mới nhất.',
    heroTitle: 'XXTCloudControl',
    heroSubtitle: 'XXTCloudControl là máy chủ điều khiển đám mây XXTouch, hỗ trợ triển khai trên Windows, macOS và Linux.',
    versionLabel: 'Phiên bản mới nhất',
    releaseLabel: 'Chi tiết bản phát hành',
    releaseLink: 'Bản phát hành GitHub',
    historyBtn: 'Lịch sử phát hành',
    docsBtn: 'Tài liệu đầy đủ',
    languageNavLabel: 'Chọn ngôn ngữ',
    downloadTitle: 'Tải bản mới nhất',
    downloadSubtitle: 'Chọn gói phù hợp với hệ điều hành của bạn.',
    screenshotAlt: 'Ảnh chụp giao diện XXTCloudControl',
    fileLabel: 'Tên tệp',
    shaLabel: 'SHA256',
    copyBtn: 'Sao chép',
    copiedBtn: 'Đã sao chép',
    copyManuallyPrompt: 'Hãy sao chép thủ công:',
    downloadBtn: 'Tải xuống',
    noAssets: 'Chưa có tệp nào để tải xuống. Vui lòng thử lại sau.',
    quickStartTitle: 'Hướng dẫn nhanh',
    quickStartSubtitle: 'Xem tài liệu đầy đủ để biết cách sử dụng và cấu hình nâng cao.',
    guideItems: [
      { title: 'Windows', body: 'Giải nén rồi chạy xxtcloudserver-windows-amd64.exe hoặc bản arm64, sau đó mở http://<địa-chỉ-máy-chủ>:46980.' },
      { title: 'macOS', body: 'Giải nén rồi chạy xxtcloudserver-darwin-arm64 hoặc amd64; dùng -set-password để khởi tạo mật khẩu khi cần.' },
      { title: 'Linux', body: 'Giải nén rồi chạy xxtcloudserver-linux-amd64 hoặc arm64. Nên dùng systemd/supervisor để duy trì dịch vụ.' },
      { title: 'Docker', body: 'Có ảnh trên Docker Hub và GHCR. Triển khai bằng docker run hoặc docker-compose.yml trong kho mã.' }
    ]
  },
  'es-ES': {
    pageTitle: 'Descargas de XXTCloudControl',
    pageDescription: 'Página oficial de descargas de XXTCloudControl, actualizada automáticamente con la versión más reciente.',
    heroTitle: 'XXTCloudControl',
    heroSubtitle: 'XXTCloudControl es el servidor de control en la nube de XXTouch y admite su implementación en Windows, macOS y Linux.',
    versionLabel: 'Última versión',
    releaseLabel: 'Detalles de la versión',
    releaseLink: 'Release de GitHub',
    historyBtn: 'Historial de versiones',
    docsBtn: 'Documentación completa',
    languageNavLabel: 'Elegir idioma',
    downloadTitle: 'Descargar la última versión',
    downloadSubtitle: 'Elige el paquete correspondiente a tu sistema operativo.',
    screenshotAlt: 'Captura de la interfaz de XXTCloudControl',
    fileLabel: 'Nombre del archivo',
    shaLabel: 'SHA256',
    copyBtn: 'Copiar',
    copiedBtn: 'Copiado',
    copyManuallyPrompt: 'Copia manualmente:',
    downloadBtn: 'Descargar',
    noAssets: 'Todavía no hay archivos disponibles. Inténtalo de nuevo más tarde.',
    quickStartTitle: 'Guía rápida del software',
    quickStartSubtitle: 'Consulta la documentación completa para conocer el uso detallado y la configuración avanzada.',
    guideItems: [
      { title: 'Windows', body: 'Descomprime y ejecuta xxtcloudserver-windows-amd64.exe o la versión arm64; después abre http://<dirección-del-servidor>:46980.' },
      { title: 'macOS', body: 'Descomprime y ejecuta xxtcloudserver-darwin-arm64 o amd64. Inicializa la contraseña con -set-password cuando sea necesario.' },
      { title: 'Linux', body: 'Descomprime y ejecuta xxtcloudserver-linux-amd64 o arm64. Se recomienda usar systemd/supervisor para mantener el servicio activo.' },
      { title: 'Docker', body: 'Hay imágenes en Docker Hub y GHCR. Despliega con docker run o con el archivo docker-compose.yml del repositorio.' }
    ]
  },
  'pt-BR': {
    pageTitle: 'Downloads do XXTCloudControl',
    pageDescription: 'Página oficial de downloads do XXTCloudControl, atualizada automaticamente com a versão mais recente.',
    heroTitle: 'XXTCloudControl',
    heroSubtitle: 'O XXTCloudControl é o servidor de controle em nuvem do XXTouch e pode ser implantado no Windows, macOS e Linux.',
    versionLabel: 'Versão mais recente',
    releaseLabel: 'Detalhes da versão',
    releaseLink: 'Release do GitHub',
    historyBtn: 'Histórico de versões',
    docsBtn: 'Documentação completa',
    languageNavLabel: 'Escolher idioma',
    downloadTitle: 'Baixar a versão mais recente',
    downloadSubtitle: 'Escolha o pacote correspondente ao seu sistema operacional.',
    screenshotAlt: 'Captura da interface do XXTCloudControl',
    fileLabel: 'Nome do arquivo',
    shaLabel: 'SHA256',
    copyBtn: 'Copiar',
    copiedBtn: 'Copiado',
    copyManuallyPrompt: 'Copie manualmente:',
    downloadBtn: 'Baixar',
    noAssets: 'Ainda não há arquivos disponíveis para download. Tente novamente mais tarde.',
    quickStartTitle: 'Guia rápido do software',
    quickStartSubtitle: 'Consulte a documentação completa para instruções e configurações avançadas.',
    guideItems: [
      { title: 'Windows', body: 'Extraia e execute xxtcloudserver-windows-amd64.exe ou a versão arm64; depois abra http://<endereço-do-servidor>:46980.' },
      { title: 'macOS', body: 'Extraia e execute xxtcloudserver-darwin-arm64 ou amd64. Inicialize a senha com -set-password quando necessário.' },
      { title: 'Linux', body: 'Extraia e execute xxtcloudserver-linux-amd64 ou arm64. Recomendamos systemd/supervisor para manter o serviço em execução.' },
      { title: 'Docker', body: 'Há imagens no Docker Hub e no GHCR. Implante com docker run ou com o docker-compose.yml do repositório.' }
    ]
  },
  'ru-RU': {
    pageTitle: 'Загрузка XXTCloudControl',
    pageDescription: 'Официальная страница загрузки XXTCloudControl, автоматически обновляемая вместе с последним выпуском.',
    heroTitle: 'XXTCloudControl',
    heroSubtitle: 'XXTCloudControl — сервер облачного управления XXTouch, который можно развернуть на Windows, macOS и Linux.',
    versionLabel: 'Последняя версия',
    releaseLabel: 'Сведения о выпуске',
    releaseLink: 'Релиз GitHub',
    historyBtn: 'История выпусков',
    docsBtn: 'Полная документация',
    languageNavLabel: 'Выбрать язык',
    downloadTitle: 'Загрузить последнюю версию',
    downloadSubtitle: 'Выберите пакет для своей операционной системы.',
    screenshotAlt: 'Снимок интерфейса XXTCloudControl',
    fileLabel: 'Имя файла',
    shaLabel: 'SHA256',
    copyBtn: 'Копировать',
    copiedBtn: 'Скопировано',
    copyManuallyPrompt: 'Скопируйте вручную:',
    downloadBtn: 'Загрузить',
    noAssets: 'Файлы для загрузки пока недоступны. Повторите попытку позже.',
    quickStartTitle: 'Краткое руководство',
    quickStartSubtitle: 'Полное руководство и расширенные настройки приведены в документации.',
    guideItems: [
      { title: 'Windows', body: 'Распакуйте архив и запустите xxtcloudserver-windows-amd64.exe либо сборку arm64, затем откройте http://<адрес-сервера>:46980.' },
      { title: 'macOS', body: 'Распакуйте и запустите xxtcloudserver-darwin-arm64 либо amd64. При необходимости задайте пароль командой -set-password.' },
      { title: 'Linux', body: 'Распакуйте и запустите xxtcloudserver-linux-amd64 либо arm64. Для постоянной работы рекомендуется systemd/supervisor.' },
      { title: 'Docker', body: 'Образы доступны в Docker Hub и GHCR. Используйте docker run или файл docker-compose.yml из репозитория.' }
    ]
  },
  'fr-FR': {
    pageTitle: 'Téléchargements de XXTCloudControl',
    pageDescription: 'Page officielle de téléchargement de XXTCloudControl, automatiquement mise à jour avec la dernière version.',
    heroTitle: 'XXTCloudControl',
    heroSubtitle: 'XXTCloudControl est le serveur de contrôle cloud de XXTouch, déployable sous Windows, macOS et Linux.',
    versionLabel: 'Dernière version',
    releaseLabel: 'Détails de la version',
    releaseLink: 'Release GitHub',
    historyBtn: 'Historique des versions',
    docsBtn: 'Documentation complète',
    languageNavLabel: 'Choisir la langue',
    downloadTitle: 'Télécharger la dernière version',
    downloadSubtitle: 'Choisissez le paquet correspondant à votre système d’exploitation.',
    screenshotAlt: 'Capture de l’interface XXTCloudControl',
    fileLabel: 'Nom du fichier',
    shaLabel: 'SHA256',
    copyBtn: 'Copier',
    copiedBtn: 'Copié',
    copyManuallyPrompt: 'Copiez manuellement :',
    downloadBtn: 'Télécharger',
    noAssets: 'Aucun fichier n’est encore disponible. Réessayez plus tard.',
    quickStartTitle: 'Guide rapide du logiciel',
    quickStartSubtitle: 'Consultez la documentation complète pour toutes les instructions et les réglages avancés.',
    guideItems: [
      { title: 'Windows', body: 'Décompressez puis exécutez xxtcloudserver-windows-amd64.exe ou la version arm64, et ouvrez http://<adresse-du-serveur>:46980.' },
      { title: 'macOS', body: 'Décompressez puis exécutez xxtcloudserver-darwin-arm64 ou amd64. Initialisez le mot de passe avec -set-password si nécessaire.' },
      { title: 'Linux', body: 'Décompressez puis exécutez xxtcloudserver-linux-amd64 ou arm64. Utilisez de préférence systemd/supervisor pour maintenir le service actif.' },
      { title: 'Docker', body: 'Des images sont disponibles sur Docker Hub et GHCR. Déployez avec docker run ou le fichier docker-compose.yml du dépôt.' }
    ]
  },
  'de-DE': {
    pageTitle: 'XXTCloudControl herunterladen',
    pageDescription: 'Offizielle Downloadseite von XXTCloudControl, die automatisch mit der neuesten Version aktualisiert wird.',
    heroTitle: 'XXTCloudControl',
    heroSubtitle: 'XXTCloudControl ist der Cloud-Steuerungsserver von XXTouch und kann unter Windows, macOS und Linux bereitgestellt werden.',
    versionLabel: 'Neueste Version',
    releaseLabel: 'Versionsdetails',
    releaseLink: 'GitHub-Release',
    historyBtn: 'Versionsverlauf',
    docsBtn: 'Vollständige Dokumentation',
    languageNavLabel: 'Sprache auswählen',
    downloadTitle: 'Neueste Version herunterladen',
    downloadSubtitle: 'Wählen Sie das Paket für Ihr Betriebssystem aus.',
    screenshotAlt: 'Bildschirmfoto der XXTCloudControl-Oberfläche',
    fileLabel: 'Dateiname',
    shaLabel: 'SHA256',
    copyBtn: 'Kopieren',
    copiedBtn: 'Kopiert',
    copyManuallyPrompt: 'Manuell kopieren:',
    downloadBtn: 'Herunterladen',
    noAssets: 'Zurzeit sind keine Dateien verfügbar. Versuchen Sie es später erneut.',
    quickStartTitle: 'Kurzanleitung',
    quickStartSubtitle: 'Vollständige Anweisungen und erweiterte Einstellungen finden Sie in der Dokumentation.',
    guideItems: [
      { title: 'Windows', body: 'Entpacken und starten Sie xxtcloudserver-windows-amd64.exe oder die arm64-Version. Öffnen Sie danach http://<server-adresse>:46980.' },
      { title: 'macOS', body: 'Entpacken und starten Sie xxtcloudserver-darwin-arm64 oder amd64. Initialisieren Sie das Kennwort bei Bedarf mit -set-password.' },
      { title: 'Linux', body: 'Entpacken und starten Sie xxtcloudserver-linux-amd64 oder arm64. Für den dauerhaften Betrieb wird systemd/supervisor empfohlen.' },
      { title: 'Docker', body: 'Images sind über Docker Hub und GHCR verfügbar. Verwenden Sie docker run oder die docker-compose.yml des Repositorys.' }
    ]
  }
};

export function sitePathForLocale(locale: SiteLocale): string {
  const slug = siteLocaleMeta[locale].slug;
  return slug ? `${slug}/` : '';
}

export function docsURLForLocale(locale: SiteLocale): string {
  const repository = 'https://github.com/havonz/XXTCloudControl';
  if (locale === 'zh-CN') {
    return `${repository}#readme`;
  }
  return `${repository}/blob/main/docs/i18n/README.${locale}.md`;
}
