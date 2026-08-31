package main

// The array order follows supportedLocales. Keeping every locale in the same
// row makes missing translations visible during review and easy to validate.
var translationCatalog = map[string][supportedLocaleCount]string{
	"error.unauthorized": {
		"未授权", "Unauthorized", "未授權", "認証されていません", "인증되지 않았습니다", "Chưa được ủy quyền", "No autorizado", "Não autorizado", "Нет авторизации", "Non autorisé", "Nicht autorisiert",
	},
	"error.invalid_request": {
		"无效请求", "Invalid request", "無效請求", "無効なリクエストです", "잘못된 요청입니다", "Yêu cầu không hợp lệ", "Solicitud no válida", "Solicitação inválida", "Недопустимый запрос", "Requête non valide", "Ungültige Anfrage",
	},
	"error.invalid_request_body": {
		"无效请求体", "Invalid request body", "無效請求內容", "リクエスト本文が無効です", "요청 본문이 잘못되었습니다", "Nội dung yêu cầu không hợp lệ", "El cuerpo de la solicitud no es válido", "O corpo da solicitação é inválido", "Недопустимое тело запроса", "Corps de requête non valide", "Ungültiger Anfrageinhalt",
	},
	"error.internal": {
		"服务器内部错误", "Internal server error", "伺服器內部錯誤", "サーバー内部エラー", "서버 내부 오류", "Lỗi máy chủ nội bộ", "Error interno del servidor", "Erro interno do servidor", "Внутренняя ошибка сервера", "Erreur interne du serveur", "Interner Serverfehler",
	},
	"error.request.failed": {
		"请求失败", "Request failed", "請求失敗", "リクエストに失敗しました", "요청에 실패했습니다", "Yêu cầu thất bại", "La solicitud ha fallado", "Falha na solicitação", "Не удалось выполнить запрос", "Échec de la requête", "Anfrage fehlgeschlagen",
	},
	"error.group.name_required": {
		"分组名称不能为空", "Group name cannot be empty", "群組名稱不能為空", "グループ名を入力してください", "그룹 이름을 입력하세요", "Tên nhóm không được để trống", "El nombre del grupo no puede estar vacío", "O nome do grupo não pode ficar vazio", "Название группы не может быть пустым", "Le nom du groupe ne peut pas être vide", "Der Gruppenname darf nicht leer sein",
	},
	"error.group.not_found": {
		"分组不存在", "Group not found", "找不到群組", "グループが見つかりません", "그룹을 찾을 수 없습니다", "Không tìm thấy nhóm", "No se ha encontrado el grupo", "Grupo não encontrado", "Группа не найдена", "Groupe introuvable", "Gruppe nicht gefunden",
	},
	"error.group.save_failed": {
		"保存分组失败", "Failed to save groups", "儲存群組失敗", "グループを保存できませんでした", "그룹을 저장하지 못했습니다", "Không thể lưu nhóm", "No se han podido guardar los grupos", "Não foi possível salvar os grupos", "Не удалось сохранить группы", "Échec de l’enregistrement des groupes", "Gruppen konnten nicht gespeichert werden",
	},
	"error.group.order_required": {
		"排序列表不能为空", "Order cannot be empty", "排序清單不能為空", "並び順を指定してください", "정렬 목록을 입력하세요", "Danh sách thứ tự không được để trống", "El orden no puede estar vacío", "A ordem não pode ficar vazia", "Порядок не может быть пустым", "L’ordre ne peut pas être vide", "Die Reihenfolge darf nicht leer sein",
	},
	"error.group.order_incomplete": {
		"排序列表必须包含所有分组", "Order must include all groups", "排序清單必須包含所有群組", "並び順にはすべてのグループを含めてください", "정렬 목록에 모든 그룹이 포함되어야 합니다", "Thứ tự phải bao gồm tất cả các nhóm", "El orden debe incluir todos los grupos", "A ordem deve incluir todos os grupos", "Порядок должен включать все группы", "L’ordre doit inclure tous les groupes", "Die Reihenfolge muss alle Gruppen enthalten",
	},
	"error.group.order_duplicate": {
		"排序列表包含重复分组 ID", "Order contains duplicate group IDs", "排序清單包含重複的群組 ID", "並び順に重複したグループ ID があります", "정렬 목록에 중복된 그룹 ID가 있습니다", "Thứ tự chứa ID nhóm trùng lặp", "El orden contiene ID de grupo duplicados", "A ordem contém IDs de grupo duplicados", "Порядок содержит повторяющиеся ID групп", "L’ordre contient des ID de groupe en double", "Die Reihenfolge enthält doppelte Gruppen-IDs",
	},
	"error.group.order_unknown": {
		"排序列表包含未知分组 ID", "Order contains an unknown group ID", "排序清單包含未知的群組 ID", "並び順に不明なグループ ID があります", "정렬 목록에 알 수 없는 그룹 ID가 있습니다", "Thứ tự chứa ID nhóm không xác định", "El orden contiene un ID de grupo desconocido", "A ordem contém um ID de grupo desconhecido", "Порядок содержит неизвестный ID группы", "L’ordre contient un ID de groupe inconnu", "Die Reihenfolge enthält eine unbekannte Gruppen-ID",
	},
	"error.script.required": {
		"脚本不能为空", "Script is required", "必須指定腳本", "スクリプトを指定してください", "스크립트가 필요합니다", "Cần chỉ định tập lệnh", "Se requiere un script", "É necessário informar um script", "Необходимо указать скрипт", "Un script est requis", "Ein Skript ist erforderlich",
	},
	"error.config.save_failed": {
		"保存配置失败", "Failed to save configuration", "儲存設定失敗", "設定を保存できませんでした", "설정을 저장하지 못했습니다", "Không thể lưu cấu hình", "No se ha podido guardar la configuración", "Não foi possível salvar a configuração", "Не удалось сохранить конфигурацию", "Échec de l’enregistrement de la configuration", "Konfiguration konnte nicht gespeichert werden",
	},
	"error.config.build_failed": {
		"生成配置失败", "Failed to build configuration", "產生設定失敗", "設定を生成できませんでした", "설정을 생성하지 못했습니다", "Không thể tạo cấu hình", "No se ha podido generar la configuración", "Não foi possível gerar a configuração", "Не удалось создать конфигурацию", "Échec de la génération de la configuration", "Konfiguration konnte nicht erstellt werden",
	},
	"error.host.required": {
		"缺少 host 参数", "The host parameter is required", "缺少 host 參數", "host パラメーターが必要です", "host 매개변수가 필요합니다", "Thiếu tham số host", "Se requiere el parámetro host", "O parâmetro host é obrigatório", "Требуется параметр host", "Le paramètre host est requis", "Der Parameter host ist erforderlich",
	},
	"error.host.invalid": {
		"主机地址无效", "Invalid host", "主機位址無效", "ホストが無効です", "호스트가 잘못되었습니다", "Máy chủ không hợp lệ", "El host no es válido", "Host inválido", "Недопустимый хост", "Hôte non valide", "Ungültiger Host",
	},
	"error.port.invalid": {
		"端口无效", "Invalid port", "連接埠無效", "ポートが無効です", "포트가 잘못되었습니다", "Cổng không hợp lệ", "El puerto no es válido", "Porta inválida", "Недопустимый порт", "Port non valide", "Ungültiger Port",
	},
	"error.update.not_initialized": {
		"更新服务未初始化", "updater not initialized", "更新服務尚未初始化", "更新サービスが初期化されていません", "업데이트 서비스가 초기화되지 않았습니다", "Dịch vụ cập nhật chưa được khởi tạo", "El servicio de actualización no está inicializado", "O serviço de atualização não foi inicializado", "Служба обновления не инициализирована", "Le service de mise à jour n’est pas initialisé", "Der Aktualisierungsdienst ist nicht initialisiert",
	},
	"message.update.download_cancel_requested": {
		"已请求停止下载", "Download cancellation requested", "已要求停止下載", "ダウンロードのキャンセルを要求しました", "다운로드 취소를 요청했습니다", "Đã yêu cầu hủy tải xuống", "Se ha solicitado cancelar la descarga", "O cancelamento do download foi solicitado", "Запрошена отмена загрузки", "L’annulation du téléchargement a été demandée", "Abbruch des Downloads wurde angefordert",
	},
	"message.update.apply_started": {
		"正在应用更新，服务将短暂重启", "The update is being applied. The server will restart shortly.", "正在套用更新，服務即將短暫重新啟動", "更新を適用しています。サーバーはまもなく再起動します。", "업데이트를 적용 중입니다. 서버가 곧 다시 시작됩니다.", "Đang áp dụng bản cập nhật. Máy chủ sẽ sớm khởi động lại.", "Se está aplicando la actualización. El servidor se reiniciará en breve.", "A atualização está sendo aplicada. O servidor será reiniciado em breve.", "Обновление применяется. Сервер вскоре перезапустится.", "La mise à jour est en cours d’application. Le serveur va bientôt redémarrer.", "Das Update wird angewendet. Der Server wird in Kürze neu gestartet.",
	},
	"error.device_ids.required": {
		"deviceIds 不能为空", "deviceIds is required", "deviceIds 不能為空", "deviceIds を指定してください", "deviceIds가 필요합니다", "Cần cung cấp deviceIds", "Se requiere deviceIds", "deviceIds é obrigatório", "Требуется deviceIds", "deviceIds est requis", "deviceIds ist erforderlich",
	},
	"error.devices.required": {
		"设备列表不能为空", "The device list is required", "裝置清單不能為空", "デバイス一覧を指定してください", "기기 목록이 필요합니다", "Cần cung cấp danh sách thiết bị", "Se requiere la lista de dispositivos", "A lista de dispositivos é obrigatória", "Требуется список устройств", "La liste des appareils est requise", "Die Geräteliste ist erforderlich",
	},
	"error.device_sn.required": {
		"deviceSN 不能为空", "deviceSN is required", "deviceSN 不能為空", "deviceSN を指定してください", "deviceSN이 필요합니다", "Cần cung cấp deviceSN", "Se requiere deviceSN", "deviceSN é obrigatório", "Требуется deviceSN", "deviceSN est requis", "deviceSN ist erforderlich",
	},
	"error.name.required": {
		"名称不能为空", "Name is required", "名稱不能為空", "名前を入力してください", "이름이 필요합니다", "Cần nhập tên", "Se requiere el nombre", "O nome é obrigatório", "Требуется имя", "Le nom est requis", "Ein Name ist erforderlich",
	},
	"error.path.required": {
		"路径不能为空", "Path is required", "路徑不能為空", "パスを指定してください", "경로가 필요합니다", "Cần cung cấp đường dẫn", "Se requiere la ruta", "O caminho é obrigatório", "Требуется путь", "Le chemin est requis", "Ein Pfad ist erforderlich",
	},
	"error.category_path.required": {
		"category 和 path 不能为空", "category and path are required", "category 與 path 不能為空", "category と path を指定してください", "category와 path가 필요합니다", "Cần cung cấp category và path", "Se requieren category y path", "category e path são obrigatórios", "Требуются category и path", "category et path sont requis", "category und path sind erforderlich",
	},
	"error.script.name_required": {
		"脚本名称不能为空", "Script name is required", "腳本名稱不能為空", "スクリプト名を入力してください", "스크립트 이름이 필요합니다", "Cần nhập tên tập lệnh", "Se requiere el nombre del script", "O nome do script é obrigatório", "Требуется имя скрипта", "Le nom du script est requis", "Der Skriptname ist erforderlich",
	},
	"error.script.not_found": {
		"脚本不存在", "Script not found", "找不到腳本", "スクリプトが見つかりません", "스크립트를 찾을 수 없습니다", "Không tìm thấy tập lệnh", "No se ha encontrado el script", "Script não encontrado", "Скрипт не найден", "Script introuvable", "Skript nicht gefunden",
	},
	"error.script.name_invalid": {
		"脚本名称无效", "Invalid script name", "腳本名稱無效", "スクリプト名が無効です", "스크립트 이름이 잘못되었습니다", "Tên tập lệnh không hợp lệ", "El nombre del script no es válido", "Nome de script inválido", "Недопустимое имя скрипта", "Nom de script non valide", "Ungültiger Skriptname",
	},
	"error.script.main_json_not_found": {
		"main.json 不存在", "main.json was not found", "找不到 main.json", "main.json が見つかりません", "main.json을 찾을 수 없습니다", "Không tìm thấy main.json", "No se ha encontrado main.json", "main.json não foi encontrado", "Файл main.json не найден", "main.json est introuvable", "main.json wurde nicht gefunden",
	},
	"error.script.main_json_parse_failed": {
		"解析 main.json 失败", "Failed to parse main.json", "解析 main.json 失敗", "main.json を解析できませんでした", "main.json을 구문 분석하지 못했습니다", "Không thể phân tích main.json", "No se ha podido analizar main.json", "Não foi possível analisar main.json", "Не удалось разобрать main.json", "Échec de l’analyse de main.json", "main.json konnte nicht analysiert werden",
	},
	"error.scripts.read_directory_failed": {
		"读取脚本目录失败", "Failed to read the scripts directory", "讀取腳本目錄失敗", "スクリプトディレクトリを読み取れませんでした", "스크립트 디렉터리를 읽지 못했습니다", "Không thể đọc thư mục tập lệnh", "No se ha podido leer el directorio de scripts", "Não foi possível ler o diretório de scripts", "Не удалось прочитать каталог скриптов", "Échec de la lecture du dossier des scripts", "Das Skriptverzeichnis konnte nicht gelesen werden",
	},
	"error.script.read_directory_failed": {
		"读取脚本目录失败", "Failed to read the script directory", "讀取腳本目錄失敗", "スクリプトディレクトリを読み取れませんでした", "스크립트 디렉터리를 읽지 못했습니다", "Không thể đọc thư mục tập lệnh", "No se ha podido leer el directorio del script", "Não foi possível ler o diretório do script", "Не удалось прочитать каталог скрипта", "Échec de la lecture du dossier du script", "Das Skriptverzeichnis konnte nicht gelesen werden",
	},
	"error.script.read_file_failed": {
		"读取脚本文件失败", "Failed to read the script file", "讀取腳本檔案失敗", "スクリプトファイルを読み取れませんでした", "스크립트 파일을 읽지 못했습니다", "Không thể đọc tệp tập lệnh", "No se ha podido leer el archivo del script", "Não foi possível ler o arquivo do script", "Не удалось прочитать файл скрипта", "Échec de la lecture du fichier de script", "Die Skriptdatei konnte nicht gelesen werden",
	},
	"error.json.marshal_failed": {
		"生成 JSON 失败", "Failed to generate JSON", "產生 JSON 失敗", "JSON を生成できませんでした", "JSON을 생성하지 못했습니다", "Không thể tạo JSON", "No se ha podido generar el JSON", "Não foi possível gerar o JSON", "Не удалось создать JSON", "Échec de la génération du JSON", "JSON konnte nicht erzeugt werden",
	},
	"error.path.not_directory": {
		"路径不是目录", "The path is not a directory", "路徑不是目錄", "パスはディレクトリではありません", "경로가 디렉터리가 아닙니다", "Đường dẫn không phải là thư mục", "La ruta no es un directorio", "O caminho não é um diretório", "Путь не является каталогом", "Le chemin n’est pas un dossier", "Der Pfad ist kein Verzeichnis",
	},
	"error.path.invalid": {
		"路径无效", "Invalid path", "路徑無效", "パスが無効です", "경로가 잘못되었습니다", "Đường dẫn không hợp lệ", "La ruta no es válida", "Caminho inválido", "Недопустимый путь", "Chemin non valide", "Ungültiger Pfad",
	},
	"error.path.format_invalid": {
		"路径格式无效", "Invalid path format", "路徑格式無效", "パスの形式が無効です", "경로 형식이 잘못되었습니다", "Định dạng đường dẫn không hợp lệ", "El formato de la ruta no es válido", "Formato de caminho inválido", "Недопустимый формат пути", "Format de chemin non valide", "Ungültiges Pfadformat",
	},
	"error.path.traversal": {
		"路径不能包含越级访问", "Path traversal is not allowed", "路徑不能包含跨層存取", "パスの上位階層への移動は許可されていません", "상위 경로 접근은 허용되지 않습니다", "Không cho phép truy cập vượt cấp trong đường dẫn", "No se permite atravesar directorios en la ruta", "Não é permitido percorrer diretórios no caminho", "Переход по пути за пределы каталога запрещён", "La traversée de répertoires est interdite", "Verzeichnisüberschreitungen im Pfad sind nicht zulässig",
	},
	"error.path.resolve_base_failed": {
		"解析基础路径失败", "Failed to resolve the base path", "解析基礎路徑失敗", "ベースパスを解決できませんでした", "기본 경로를 확인하지 못했습니다", "Không thể phân giải đường dẫn cơ sở", "No se ha podido resolver la ruta base", "Não foi possível resolver o caminho base", "Не удалось определить базовый путь", "Échec de la résolution du chemin de base", "Der Basispfad konnte nicht aufgelöst werden",
	},
	"error.path.resolve_file_failed": {
		"解析文件路径失败", "Failed to resolve the file path", "解析檔案路徑失敗", "ファイルパスを解決できませんでした", "파일 경로를 확인하지 못했습니다", "Không thể phân giải đường dẫn tệp", "No se ha podido resolver la ruta del archivo", "Não foi possível resolver o caminho do arquivo", "Не удалось определить путь к файлу", "Échec de la résolution du chemin du fichier", "Der Dateipfad konnte nicht aufgelöst werden",
	},
	"error.path.resolve_target_failed": {
		"解析目标路径失败", "Failed to resolve the target path", "解析目標路徑失敗", "対象パスを解決できませんでした", "대상 경로를 확인하지 못했습니다", "Không thể phân giải đường dẫn đích", "No se ha podido resolver la ruta de destino", "Não foi possível resolver o caminho de destino", "Не удалось определить целевой путь", "Échec de la résolution du chemin cible", "Der Zielpfad konnte nicht aufgelöst werden",
	},
	"error.path.resolve_source_failed": {
		"解析源路径失败", "Failed to resolve the source path", "解析來源路徑失敗", "ソースパスを解決できませんでした", "원본 경로를 확인하지 못했습니다", "Không thể phân giải đường dẫn nguồn", "No se ha podido resolver la ruta de origen", "Não foi possível resolver o caminho de origem", "Не удалось определить исходный путь", "Échec de la résolution du chemin source", "Der Quellpfad konnte nicht aufgelöst werden",
	},
	"error.path.resolve_destination_failed": {
		"解析目标路径失败", "Failed to resolve the destination path", "解析目的地路徑失敗", "保存先パスを解決できませんでした", "대상 경로를 확인하지 못했습니다", "Không thể phân giải đường dẫn đích", "No se ha podido resolver la ruta de destino", "Não foi possível resolver o caminho de destino", "Не удалось определить путь назначения", "Échec de la résolution du chemin de destination", "Der Zielpfad konnte nicht aufgelöst werden",
	},
	"error.path.resolve_source_base_failed": {
		"解析源基础路径失败", "Failed to resolve the source base path", "解析來源基礎路徑失敗", "ソースのベースパスを解決できませんでした", "원본 기본 경로를 확인하지 못했습니다", "Không thể phân giải đường dẫn cơ sở nguồn", "No se ha podido resolver la ruta base de origen", "Não foi possível resolver o caminho base de origem", "Не удалось определить исходный базовый путь", "Échec de la résolution du chemin de base source", "Der Quellbasispfad konnte nicht aufgelöst werden",
	},
	"error.path.resolve_destination_base_failed": {
		"解析目标基础路径失败", "Failed to resolve the destination base path", "解析目的地基礎路徑失敗", "保存先のベースパスを解決できませんでした", "대상 기본 경로를 확인하지 못했습니다", "Không thể phân giải đường dẫn cơ sở đích", "No se ha podido resolver la ruta base de destino", "Não foi possível resolver o caminho base de destino", "Не удалось определить базовый путь назначения", "Échec de la résolution du chemin de base de destination", "Der Zielbasispfad konnte nicht aufgelöst werden",
	},
	"error.path.source_traversal": {
		"源路径不能包含越级访问", "Source path traversal is not allowed", "來源路徑不能包含跨層存取", "ソースパスで上位階層へ移動することはできません", "원본 경로의 상위 접근은 허용되지 않습니다", "Không cho phép truy cập vượt cấp trong đường dẫn nguồn", "No se permite atravesar directorios en la ruta de origen", "Não é permitido percorrer diretórios no caminho de origem", "Переход за пределы исходного пути запрещён", "La traversée du chemin source est interdite", "Verzeichnisüberschreitungen im Quellpfad sind nicht zulässig",
	},
	"error.path.destination_traversal": {
		"目标路径不能包含越级访问", "Destination path traversal is not allowed", "目的地路徑不能包含跨層存取", "保存先のパスで上位階層へ移動することはできません", "대상 경로의 상위 접근은 허용되지 않습니다", "Không cho phép truy cập vượt cấp trong đường dẫn đích", "No se permite atravesar directorios en la ruta de destino", "Não é permitido percorrer diretórios no caminho de destino", "Переход за пределы пути назначения запрещён", "La traversée du chemin de destination est interdite", "Verzeichnisüberschreitungen im Zielpfad sind nicht zulässig",
	},
	"error.directory.create_failed": {
		"创建目录失败", "Failed to create the directory", "建立目錄失敗", "ディレクトリを作成できませんでした", "디렉터리를 만들지 못했습니다", "Không thể tạo thư mục", "No se ha podido crear el directorio", "Não foi possível criar o diretório", "Не удалось создать каталог", "Échec de la création du dossier", "Das Verzeichnis konnte nicht erstellt werden",
	},
	"error.directory.parent_create_failed": {
		"创建父目录失败", "Failed to create the parent directory", "建立上層目錄失敗", "親ディレクトリを作成できませんでした", "상위 디렉터리를 만들지 못했습니다", "Không thể tạo thư mục cha", "No se ha podido crear el directorio superior", "Não foi possível criar o diretório pai", "Не удалось создать родительский каталог", "Échec de la création du dossier parent", "Das übergeordnete Verzeichnis konnte nicht erstellt werden",
	},
	"error.directory.destination_create_failed": {
		"创建目标目录失败", "Failed to create the destination directory", "建立目的地目錄失敗", "保存先ディレクトリを作成できませんでした", "대상 디렉터리를 만들지 못했습니다", "Không thể tạo thư mục đích", "No se ha podido crear el directorio de destino", "Não foi possível criar o diretório de destino", "Не удалось создать каталог назначения", "Échec de la création du dossier de destination", "Das Zielverzeichnis konnte nicht erstellt werden",
	},
	"error.directory.download_forbidden": {
		"不能下载目录", "A directory cannot be downloaded", "不能下載目錄", "ディレクトリはダウンロードできません", "디렉터리는 다운로드할 수 없습니다", "Không thể tải xuống thư mục", "No se puede descargar un directorio", "Não é possível baixar um diretório", "Нельзя загрузить каталог", "Impossible de télécharger un dossier", "Ein Verzeichnis kann nicht heruntergeladen werden",
	},
	"error.directory.delete_root_forbidden": {
		"不能删除根目录", "The root category directory cannot be deleted", "不能刪除根目錄", "カテゴリのルートディレクトリは削除できません", "카테고리 루트 디렉터리는 삭제할 수 없습니다", "Không thể xóa thư mục gốc của danh mục", "No se puede eliminar el directorio raíz de la categoría", "Não é possível excluir o diretório raiz da categoria", "Нельзя удалить корневой каталог категории", "Impossible de supprimer le dossier racine de la catégorie", "Das Stammverzeichnis der Kategorie kann nicht gelöscht werden",
	},
	"error.directory.read_forbidden": {
		"不能以文件方式读取目录", "A directory cannot be read as a file", "不能將目錄當作檔案讀取", "ディレクトリをファイルとして読み取ることはできません", "디렉터리를 파일로 읽을 수 없습니다", "Không thể đọc thư mục như một tệp", "No se puede leer un directorio como archivo", "Não é possível ler um diretório como arquivo", "Нельзя читать каталог как файл", "Impossible de lire un dossier comme un fichier", "Ein Verzeichnis kann nicht als Datei gelesen werden",
	},
	"error.directory.write_forbidden": {
		"不能向目录写入文件内容", "A directory cannot be written as a file", "不能將目錄當作檔案寫入", "ディレクトリをファイルとして書き込むことはできません", "디렉터리를 파일로 쓸 수 없습니다", "Không thể ghi vào thư mục như một tệp", "No se puede escribir en un directorio como archivo", "Não é possível gravar em um diretório como arquivo", "Нельзя записывать в каталог как в файл", "Impossible d’écrire dans un dossier comme dans un fichier", "Ein Verzeichnis kann nicht als Datei beschrieben werden",
	},
	"error.directory.transfer_forbidden": {
		"不能传输目录", "A directory cannot be transferred", "不能傳輸目錄", "ディレクトリは転送できません", "디렉터리는 전송할 수 없습니다", "Không thể truyền thư mục", "No se puede transferir un directorio", "Não é possível transferir um diretório", "Нельзя передать каталог", "Impossible de transférer un dossier", "Ein Verzeichnis kann nicht übertragen werden",
	},
	"error.directory.push_forbidden": {
		"不能推送目录", "A directory cannot be pushed", "不能推送目錄", "ディレクトリはプッシュできません", "디렉터리는 푸시할 수 없습니다", "Không thể đẩy thư mục", "No se puede enviar un directorio", "Não é possível enviar um diretório", "Нельзя отправить каталог", "Impossible d’envoyer un dossier", "Ein Verzeichnis kann nicht gesendet werden",
	},
	"error.file.upload_missing": {
		"未上传文件", "No file was uploaded", "未上傳檔案", "ファイルがアップロードされていません", "업로드된 파일이 없습니다", "Chưa tải tệp lên", "No se ha subido ningún archivo", "Nenhum arquivo foi enviado", "Файл не загружен", "Aucun fichier n’a été envoyé", "Es wurde keine Datei hochgeladen",
	},
	"error.file.path_invalid": {
		"文件路径无效", "Invalid file path", "檔案路徑無效", "ファイルパスが無効です", "파일 경로가 잘못되었습니다", "Đường dẫn tệp không hợp lệ", "La ruta del archivo no es válida", "Caminho de arquivo inválido", "Недопустимый путь к файлу", "Chemin de fichier non valide", "Ungültiger Dateipfad",
	},
	"error.file.not_found": {
		"文件不存在", "File not found", "找不到檔案", "ファイルが見つかりません", "파일을 찾을 수 없습니다", "Không tìm thấy tệp", "No se ha encontrado el archivo", "Arquivo não encontrado", "Файл не найден", "Fichier introuvable", "Datei nicht gefunden",
	},
	"error.file.create_failed": {
		"创建文件失败", "Failed to create the file", "建立檔案失敗", "ファイルを作成できませんでした", "파일을 만들지 못했습니다", "Không thể tạo tệp", "No se ha podido crear el archivo", "Não foi possível criar o arquivo", "Не удалось создать файл", "Échec de la création du fichier", "Die Datei konnte nicht erstellt werden",
	},
	"error.file.save_failed": {
		"保存文件失败", "Failed to save the file", "儲存檔案失敗", "ファイルを保存できませんでした", "파일을 저장하지 못했습니다", "Không thể lưu tệp", "No se ha podido guardar el archivo", "Não foi possível salvar o arquivo", "Не удалось сохранить файл", "Échec de l’enregistrement du fichier", "Die Datei konnte nicht gespeichert werden",
	},
	"error.file.write_content_failed": {
		"写入文件内容失败", "Failed to write the file contents", "寫入檔案內容失敗", "ファイルの内容を書き込めませんでした", "파일 내용을 쓰지 못했습니다", "Không thể ghi nội dung tệp", "No se ha podido escribir el contenido del archivo", "Não foi possível gravar o conteúdo do arquivo", "Не удалось записать содержимое файла", "Échec de l’écriture du contenu du fichier", "Der Dateiinhalt konnte nicht geschrieben werden",
	},
	"error.file.write_failed": {
		"写入文件失败", "Failed to write the file", "寫入檔案失敗", "ファイルを書き込めませんでした", "파일을 쓰지 못했습니다", "Không thể ghi tệp", "No se ha podido escribir el archivo", "Não foi possível gravar o arquivo", "Не удалось записать файл", "Échec de l’écriture du fichier", "Die Datei konnte nicht geschrieben werden",
	},
	"error.file.open_failed": {
		"打开文件失败", "Failed to open the file", "開啟檔案失敗", "ファイルを開けませんでした", "파일을 열지 못했습니다", "Không thể mở tệp", "No se ha podido abrir el archivo", "Não foi possível abrir o arquivo", "Не удалось открыть файл", "Échec de l’ouverture du fichier", "Die Datei konnte nicht geöffnet werden",
	},
	"error.file.stat_failed": {
		"读取文件状态失败", "Failed to read file information", "讀取檔案狀態失敗", "ファイル情報を取得できませんでした", "파일 정보를 읽지 못했습니다", "Không thể đọc thông tin tệp", "No se ha podido leer la información del archivo", "Não foi possível ler as informações do arquivo", "Не удалось получить сведения о файле", "Échec de la lecture des informations du fichier", "Dateiinformationen konnten nicht gelesen werden",
	},
	"error.file.read_failed": {
		"读取文件失败", "Failed to read the file", "讀取檔案失敗", "ファイルを読み取れませんでした", "파일을 읽지 못했습니다", "Không thể đọc tệp", "No se ha podido leer el archivo", "Não foi possível ler o arquivo", "Не удалось прочитать файл", "Échec de la lecture du fichier", "Die Datei konnte nicht gelesen werden",
	},
	"error.file.too_large_5mb": {
		"文件过大（最大 5 MB）", "The file is too large (maximum 5 MB)", "檔案過大（上限 5 MB）", "ファイルが大きすぎます（最大 5 MB）", "파일이 너무 큽니다(최대 5MB)", "Tệp quá lớn (tối đa 5 MB)", "El archivo es demasiado grande (máximo 5 MB)", "O arquivo é muito grande (máximo de 5 MB)", "Файл слишком велик (не более 5 МБ)", "Le fichier est trop volumineux (5 Mo maximum)", "Die Datei ist zu groß (maximal 5 MB)",
	},
	"error.entry.not_found": {
		"文件或目录不存在", "File or directory not found", "找不到檔案或目錄", "ファイルまたはディレクトリが見つかりません", "파일 또는 디렉터리를 찾을 수 없습니다", "Không tìm thấy tệp hoặc thư mục", "No se ha encontrado el archivo o directorio", "Arquivo ou diretório não encontrado", "Файл или каталог не найден", "Fichier ou dossier introuvable", "Datei oder Verzeichnis nicht gefunden",
	},
	"error.entry.already_exists": {
		"文件或目录已存在", "The file or directory already exists", "檔案或目錄已存在", "ファイルまたはディレクトリは既に存在します", "파일 또는 디렉터리가 이미 있습니다", "Tệp hoặc thư mục đã tồn tại", "El archivo o directorio ya existe", "O arquivo ou diretório já existe", "Файл или каталог уже существует", "Le fichier ou le dossier existe déjà", "Die Datei oder das Verzeichnis ist bereits vorhanden",
	},
	"error.entry.delete_failed": {
		"删除失败", "Failed to delete the item", "刪除失敗", "削除できませんでした", "삭제하지 못했습니다", "Không thể xóa mục", "No se ha podido eliminar el elemento", "Não foi possível excluir o item", "Не удалось удалить объект", "Échec de la suppression de l’élément", "Das Element konnte nicht gelöscht werden",
	},
	"error.entry.rename_failed": {
		"重命名失败", "Failed to rename the item", "重新命名失敗", "名前を変更できませんでした", "이름을 바꾸지 못했습니다", "Không thể đổi tên mục", "No se ha podido cambiar el nombre", "Não foi possível renomear o item", "Не удалось переименовать объект", "Échec du renommage de l’élément", "Das Element konnte nicht umbenannt werden",
	},
	"error.entry.open_failed": {
		"打开失败", "Failed to open the item", "開啟失敗", "開けませんでした", "열지 못했습니다", "Không thể mở mục", "No se ha podido abrir el elemento", "Não foi possível abrir o item", "Не удалось открыть объект", "Échec de l’ouverture de l’élément", "Das Element konnte nicht geöffnet werden",
	},
	"error.entry.type_invalid": {
		"type 必须是 'file' 或 'dir'", "type must be 'file' or 'dir'", "type 必須是 'file' 或 'dir'", "type は 'file' または 'dir' である必要があります", "type은 'file' 또는 'dir'이어야 합니다", "type phải là 'file' hoặc 'dir'", "type debe ser 'file' o 'dir'", "type deve ser 'file' ou 'dir'", "type должен быть 'file' или 'dir'", "type doit être 'file' ou 'dir'", "type muss 'file' oder 'dir' sein",
	},
	"error.rename.names_required": {
		"oldName 和 newName 不能为空", "oldName and newName are required", "oldName 與 newName 不能為空", "oldName と newName を指定してください", "oldName과 newName이 필요합니다", "Cần cung cấp oldName và newName", "Se requieren oldName y newName", "oldName e newName são obrigatórios", "Требуются oldName и newName", "oldName et newName sont requis", "oldName und newName sind erforderlich",
	},
	"error.local_only": {
		"仅允许本机操作", "This operation is only allowed from the local machine", "僅允許從本機操作", "この操作はローカルマシンからのみ実行できます", "이 작업은 로컬 컴퓨터에서만 허용됩니다", "Thao tác này chỉ được phép từ máy cục bộ", "Esta operación solo se permite desde el equipo local", "Esta operação só é permitida na máquina local", "Операция разрешена только с локального компьютера", "Cette opération n’est autorisée que depuis la machine locale", "Dieser Vorgang ist nur auf dem lokalen Rechner zulässig",
	},
	"error.batch.copy_empty": {
		"没有要复制的项目", "There are no items to copy", "沒有要複製的項目", "コピーする項目がありません", "복사할 항목이 없습니다", "Không có mục nào để sao chép", "No hay elementos que copiar", "Não há itens para copiar", "Нет объектов для копирования", "Aucun élément à copier", "Es sind keine Elemente zum Kopieren vorhanden",
	},
	"error.batch.move_empty": {
		"没有要移动的项目", "There are no items to move", "沒有要移動的項目", "移動する項目がありません", "이동할 항목이 없습니다", "Không có mục nào để di chuyển", "No hay elementos que mover", "Não há itens para mover", "Нет объектов для перемещения", "Aucun élément à déplacer", "Es sind keine Elemente zum Verschieben vorhanden",
	},
	"error.item.path_required": {
		"项目路径不能为空", "Item path is required", "項目路徑不能為空", "項目のパスを指定してください", "항목 경로가 필요합니다", "Cần cung cấp đường dẫn mục", "Se requiere la ruta del elemento", "O caminho do item é obrigatório", "Требуется путь к объекту", "Le chemin de l’élément est requis", "Der Elementpfad ist erforderlich",
	},
	"error.item.path_relative": {
		"项目路径必须是相对路径", "Item path must be relative", "項目路徑必須是相對路徑", "項目のパスは相対パスである必要があります", "항목 경로는 상대 경로여야 합니다", "Đường dẫn mục phải là đường dẫn tương đối", "La ruta del elemento debe ser relativa", "O caminho do item deve ser relativo", "Путь к объекту должен быть относительным", "Le chemin de l’élément doit être relatif", "Der Elementpfad muss relativ sein",
	},
	"error.item.path_invalid": {
		"项目路径无效", "Invalid item path", "項目路徑無效", "項目のパスが無効です", "항목 경로가 잘못되었습니다", "Đường dẫn mục không hợp lệ", "La ruta del elemento no es válida", "Caminho de item inválido", "Недопустимый путь к объекту", "Chemin d’élément non valide", "Ungültiger Elementpfad",
	},
	"error.item.path_traversal": {
		"项目路径不能包含越级访问", "Item path traversal is not allowed", "項目路徑不能包含跨層存取", "項目のパスで上位階層へ移動することはできません", "항목 경로의 상위 접근은 허용되지 않습니다", "Không cho phép truy cập vượt cấp trong đường dẫn mục", "No se permite atravesar directorios en la ruta del elemento", "Não é permitido percorrer diretórios no caminho do item", "Переход за пределы пути объекта запрещён", "La traversée du chemin de l’élément est interdite", "Verzeichnisüberschreitungen im Elementpfad sind nicht zulässig",
	},
	"error.category.invalid": {
		"类别无效", "Invalid category", "類別無效", "カテゴリが無効です", "카테고리가 잘못되었습니다", "Danh mục không hợp lệ", "La categoría no es válida", "Categoria inválida", "Недопустимая категория", "Catégorie non valide", "Ungültige Kategorie",
	},
	"error.category.invalid_value": {
		"类别无效: {category}", "Invalid category: {category}", "類別無效：{category}", "カテゴリが無効です: {category}", "카테고리가 잘못되었습니다: {category}", "Danh mục không hợp lệ: {category}", "Categoría no válida: {category}", "Categoria inválida: {category}", "Недопустимая категория: {category}", "Catégorie non valide : {category}", "Ungültige Kategorie: {category}",
	},
	"error.name.invalid": {
		"名称无效", "Invalid name", "名稱無效", "名前が無効です", "이름이 잘못되었습니다", "Tên không hợp lệ", "El nombre no es válido", "Nome inválido", "Недопустимое имя", "Nom non valide", "Ungültiger Name",
	},
	"error.name.path_separator": {
		"名称不能包含路径分隔符", "Name cannot contain path separators", "名稱不能包含路徑分隔符", "名前にパス区切り文字は使用できません", "이름에 경로 구분자를 사용할 수 없습니다", "Tên không được chứa dấu phân cách đường dẫn", "El nombre no puede contener separadores de ruta", "O nome não pode conter separadores de caminho", "Имя не должно содержать разделители пути", "Le nom ne peut pas contenir de séparateurs de chemin", "Der Name darf keine Pfadtrennzeichen enthalten",
	},
	"error.not_found": {
		"不存在", "Not found", "不存在", "見つかりません", "찾을 수 없습니다", "Không tìm thấy", "No encontrado", "Não encontrado", "Не найдено", "Introuvable", "Nicht gefunden",
	},
	"error.destination.exists": {
		"目标位置已存在", "An item already exists at the destination", "目的地已存在項目", "保存先に項目が既に存在します", "대상 위치에 항목이 이미 있습니다", "Đã có mục tại vị trí đích", "Ya existe un elemento en el destino", "Já existe um item no destino", "В месте назначения уже есть объект", "Un élément existe déjà à la destination", "Am Ziel ist bereits ein Element vorhanden",
	},
	"error.source_symlink_remove_failed": {
		"删除源符号链接失败", "Failed to remove the source symbolic link", "刪除來源符號連結失敗", "ソースのシンボリックリンクを削除できませんでした", "원본 심볼릭 링크를 삭제하지 못했습니다", "Không thể xóa liên kết tượng trưng nguồn", "No se ha podido eliminar el enlace simbólico de origen", "Não foi possível remover o link simbólico de origem", "Не удалось удалить исходную символическую ссылку", "Échec de la suppression du lien symbolique source", "Der Quell-Symlink konnte nicht entfernt werden",
	},
	"error.source_directory_remove_failed": {
		"删除源目录失败", "Failed to remove the source directory", "刪除來源目錄失敗", "ソースディレクトリを削除できませんでした", "원본 디렉터리를 삭제하지 못했습니다", "Không thể xóa thư mục nguồn", "No se ha podido eliminar el directorio de origen", "Não foi possível remover o diretório de origem", "Не удалось удалить исходный каталог", "Échec de la suppression du dossier source", "Das Quellverzeichnis konnte nicht entfernt werden",
	},
	"error.source_file_remove_failed": {
		"删除源文件失败", "Failed to remove the source file", "刪除來源檔案失敗", "ソースファイルを削除できませんでした", "원본 파일을 삭제하지 못했습니다", "Không thể xóa tệp nguồn", "No se ha podido eliminar el archivo de origen", "Não foi possível remover o arquivo de origem", "Не удалось удалить исходный файл", "Échec de la suppression du fichier source", "Die Quelldatei konnte nicht entfernt werden",
	},
	"error.transfer.type_invalid": {
		"type 必须是 'download' 或 'upload'", "type must be 'download' or 'upload'", "type 必須是 'download' 或 'upload'", "type は 'download' または 'upload' である必要があります", "type은 'download' 또는 'upload'여야 합니다", "type phải là 'download' hoặc 'upload'", "type debe ser 'download' o 'upload'", "type deve ser 'download' ou 'upload'", "type должен быть 'download' или 'upload'", "type doit être 'download' ou 'upload'", "type muss 'download' oder 'upload' sein",
	},
	"error.transfer.target_path_required": {
		"下载时 targetPath 不能为空", "targetPath is required for downloads", "下載時 targetPath 不能為空", "ダウンロードには targetPath が必要です", "다운로드에는 targetPath가 필요합니다", "Cần cung cấp targetPath khi tải xuống", "Se requiere targetPath para las descargas", "targetPath é obrigatório para downloads", "Для загрузки требуется targetPath", "targetPath est requis pour les téléchargements", "Für Downloads ist targetPath erforderlich",
	},
	"error.transfer.push_fields_required": {
		"deviceSN、category、path 和 targetPath 不能为空", "deviceSN, category, path, and targetPath are required", "deviceSN、category、path 與 targetPath 不能為空", "deviceSN、category、path、targetPath を指定してください", "deviceSN, category, path 및 targetPath가 필요합니다", "Cần cung cấp deviceSN, category, path và targetPath", "Se requieren deviceSN, category, path y targetPath", "deviceSN, category, path e targetPath são obrigatórios", "Требуются deviceSN, category, path и targetPath", "deviceSN, category, path et targetPath sont requis", "deviceSN, category, path und targetPath sind erforderlich",
	},
	"error.transfer.pull_fields_required": {
		"deviceSN、sourcePath、category 和 path 不能为空", "deviceSN, sourcePath, category, and path are required", "deviceSN、sourcePath、category 與 path 不能為空", "deviceSN、sourcePath、category、path を指定してください", "deviceSN, sourcePath, category 및 path가 필요합니다", "Cần cung cấp deviceSN, sourcePath, category và path", "Se requieren deviceSN, sourcePath, category y path", "deviceSN, sourcePath, category e path são obrigatórios", "Требуются deviceSN, sourcePath, category и path", "deviceSN, sourcePath, category et path sont requis", "deviceSN, sourcePath, category und path sind erforderlich",
	},
	"error.transfer.send_device_failed": {
		"发送文件到设备失败", "Failed to send the file to the device", "傳送檔案到裝置失敗", "ファイルをデバイスに送信できませんでした", "기기로 파일을 전송하지 못했습니다", "Không thể gửi tệp đến thiết bị", "No se ha podido enviar el archivo al dispositivo", "Não foi possível enviar o arquivo ao dispositivo", "Не удалось отправить файл на устройство", "Échec de l’envoi du fichier à l’appareil", "Die Datei konnte nicht an das Gerät gesendet werden",
	},
	"error.token.required": {
		"token 不能为空", "Token is required", "token 不能為空", "token を指定してください", "token이 필요합니다", "Cần cung cấp token", "Se requiere el token", "O token é obrigatório", "Требуется token", "Le token est requis", "Ein Token ist erforderlich",
	},
	"error.token.not_found_or_expired": {
		"token 不存在或已过期", "Token not found or expired", "找不到 token 或 token 已過期", "token が見つからないか、有効期限が切れています", "token을 찾을 수 없거나 만료되었습니다", "Không tìm thấy token hoặc token đã hết hạn", "No se ha encontrado el token o ha caducado", "Token não encontrado ou expirado", "Token не найден или срок его действия истёк", "Token introuvable ou expiré", "Token nicht gefunden oder abgelaufen",
	},
	"error.token.expired": {
		"token 已过期", "Token has expired", "token 已過期", "token の有効期限が切れています", "token이 만료되었습니다", "Token đã hết hạn", "El token ha caducado", "O token expirou", "Срок действия token истёк", "Le token a expiré", "Der Token ist abgelaufen",
	},
	"error.token.not_download": {
		"token 不是下载 token", "The token is not valid for downloads", "此 token 不能用於下載", "この token はダウンロード用ではありません", "이 token은 다운로드용이 아닙니다", "Token không dành cho tải xuống", "El token no es válido para descargas", "O token não é válido para downloads", "Token не предназначен для загрузки", "Le token n’est pas valable pour un téléchargement", "Der Token ist nicht für Downloads gültig",
	},
	"error.token.not_upload": {
		"token 不是上传 token", "The token is not valid for uploads", "此 token 不能用於上傳", "この token はアップロード用ではありません", "이 token은 업로드용이 아닙니다", "Token không dành cho tải lên", "El token no es válido para subidas", "O token não é válido para uploads", "Token не предназначен для отправки", "Le token n’est pas valable pour un envoi", "Der Token ist nicht für Uploads gültig",
	},
	"error.device.not_connected": {
		"设备未连接", "Device is not connected", "裝置未連線", "デバイスが接続されていません", "기기가 연결되지 않았습니다", "Thiết bị chưa được kết nối", "El dispositivo no está conectado", "O dispositivo não está conectado", "Устройство не подключено", "L’appareil n’est pas connecté", "Das Gerät ist nicht verbunden",
	},
	"error.device.named_not_connected": {
		"设备 {device} 未连接", "Device {device} is not connected", "裝置 {device} 未連線", "デバイス {device} が接続されていません", "기기 {device}가 연결되지 않았습니다", "Thiết bị {device} chưa được kết nối", "El dispositivo {device} no está conectado", "O dispositivo {device} não está conectado", "Устройство {device} не подключено", "L’appareil {device} n’est pas connecté", "Das Gerät {device} ist nicht verbunden",
	},
	"error.device.offline": {
		"设备离线", "Device is offline", "裝置已離線", "デバイスはオフラインです", "기기가 오프라인입니다", "Thiết bị đang ngoại tuyến", "El dispositivo está fuera de línea", "O dispositivo está offline", "Устройство не в сети", "L’appareil est hors ligne", "Das Gerät ist offline",
	},
	"error.snapshot.empty_payload": {
		"截图内容为空", "The screenshot is empty", "截圖內容為空", "スクリーンショットが空です", "스크린샷이 비어 있습니다", "Ảnh chụp màn hình trống", "La captura de pantalla está vacía", "A captura de tela está vazia", "Снимок экрана пуст", "La capture d’écran est vide", "Der Screenshot ist leer",
	},
	"error.snapshot.failed": {
		"截图失败", "Failed to capture the screenshot", "截圖失敗", "スクリーンショットを取得できませんでした", "스크린샷을 캡처하지 못했습니다", "Không thể chụp màn hình", "No se ha podido capturar la pantalla", "Não foi possível capturar a tela", "Не удалось сделать снимок экрана", "Échec de la capture d’écran", "Der Screenshot konnte nicht erstellt werden",
	},
	"error.request.timeout": {
		"请求超时", "Request timed out", "請求逾時", "リクエストがタイムアウトしました", "요청 시간이 초과되었습니다", "Yêu cầu đã hết thời gian chờ", "La solicitud ha agotado el tiempo de espera", "A solicitação expirou", "Время ожидания запроса истекло", "La requête a expiré", "Zeitüberschreitung der Anfrage",
	},
	"error.response.invalid_body_size": {
		"响应内容大小无效", "Invalid response body size", "回應內容大小無效", "レスポンス本文のサイズが無効です", "응답 본문 크기가 잘못되었습니다", "Kích thước nội dung phản hồi không hợp lệ", "El tamaño del cuerpo de la respuesta no es válido", "O tamanho do corpo da resposta é inválido", "Недопустимый размер тела ответа", "Taille du corps de réponse non valide", "Ungültige Größe des Antwortinhalts",
	},
	"error.response.body_too_large": {
		"响应内容过大", "Response body is too large", "回應內容過大", "レスポンス本文が大きすぎます", "응답 본문이 너무 큽니다", "Nội dung phản hồi quá lớn", "El cuerpo de la respuesta es demasiado grande", "O corpo da resposta é muito grande", "Тело ответа слишком велико", "Le corps de la réponse est trop volumineux", "Der Antwortinhalt ist zu groß",
	},
	"error.response.chunk_too_large": {
		"响应分片过大", "Response chunk is too large", "回應分片過大", "レスポンスのチャンクが大きすぎます", "응답 청크가 너무 큽니다", "Phân đoạn phản hồi quá lớn", "El fragmento de respuesta es demasiado grande", "O fragmento da resposta é muito grande", "Фрагмент ответа слишком велик", "Le fragment de réponse est trop volumineux", "Das Antwortsegment ist zu groß",
	},
	"error.response.chunk_count_invalid": {
		"响应分片数量无效", "Invalid response chunk count", "回應分片數量無效", "レスポンスのチャンク数が無効です", "응답 청크 수가 잘못되었습니다", "Số lượng phân đoạn phản hồi không hợp lệ", "El número de fragmentos de respuesta no es válido", "A quantidade de fragmentos da resposta é inválida", "Недопустимое число фрагментов ответа", "Nombre de fragments de réponse non valide", "Ungültige Anzahl von Antwortsegmenten",
	},
	"error.script.root_not_directory": {
		"脚本根路径不是目录: {path}", "The script root is not a directory: {path}", "腳本根路徑不是目錄：{path}", "スクリプトのルートパスはディレクトリではありません: {path}", "스크립트 루트 경로가 디렉터리가 아닙니다: {path}", "Đường dẫn gốc của tập lệnh không phải là thư mục: {path}", "La raíz del script no es un directorio: {path}", "A raiz do script não é um diretório: {path}", "Корневой путь скрипта не является каталогом: {path}", "La racine du script n’est pas un dossier : {path}", "Der Skript-Stammpfad ist kein Verzeichnis: {path}",
	},
	"error.script.config_empty": {
		"脚本配置项不能为空: {caption}", "Script configuration field cannot be empty: {caption}", "腳本設定欄位不能為空：{caption}", "スクリプト設定項目を入力してください: {caption}", "스크립트 설정 필드는 비워 둘 수 없습니다: {caption}", "Trường cấu hình tập lệnh không được để trống: {caption}", "El campo de configuración del script no puede estar vacío: {caption}", "O campo de configuração do script não pode ficar vazio: {caption}", "Поле конфигурации скрипта не может быть пустым: {caption}", "Le champ de configuration du script ne peut pas être vide : {caption}", "Das Skript-Konfigurationsfeld darf nicht leer sein: {caption}",
	},
	"error.script.config_format_invalid": {
		"脚本配置项格式不正确: {caption}", "Script configuration field has an invalid format: {caption}", "腳本設定欄位格式不正確：{caption}", "スクリプト設定項目の形式が無効です: {caption}", "스크립트 설정 필드 형식이 잘못되었습니다: {caption}", "Định dạng trường cấu hình tập lệnh không hợp lệ: {caption}", "El formato del campo de configuración del script no es válido: {caption}", "O formato do campo de configuração do script é inválido: {caption}", "Недопустимый формат поля конфигурации скрипта: {caption}", "Le format du champ de configuration du script n’est pas valide : {caption}", "Das Skript-Konfigurationsfeld hat ein ungültiges Format: {caption}",
	},
	"error.script.config_regex_invalid": {
		"脚本配置正则无效: {caption}", "Script configuration regular expression is invalid: {caption}", "腳本設定的規則運算式無效：{caption}", "スクリプト設定の正規表現が無効です: {caption}", "스크립트 설정 정규식이 잘못되었습니다: {caption}", "Biểu thức chính quy trong cấu hình tập lệnh không hợp lệ: {caption}", "La expresión regular de la configuración del script no es válida: {caption}", "A expressão regular da configuração do script é inválida: {caption}", "Недопустимое регулярное выражение конфигурации скрипта: {caption}", "L’expression régulière de la configuration du script n’est pas valide : {caption}", "Der reguläre Ausdruck der Skriptkonfiguration ist ungültig: {caption}",
	},
	"error.archive.must_be_file": {
		"局域网控制脚本包必须是文件", "The LAN control script package must be a file", "區域網路控制腳本套件必須是檔案", "LAN コントロールスクリプトパッケージはファイルである必要があります", "LAN 제어 스크립트 패키지는 파일이어야 합니다", "Gói tập lệnh điều khiển LAN phải là một tệp", "El paquete de scripts de control LAN debe ser un archivo", "O pacote de script de controle LAN deve ser um arquivo", "Пакет скрипта управления по LAN должен быть файлом", "Le paquet de script de contrôle LAN doit être un fichier", "Das LAN-Steuerskriptpaket muss eine Datei sein",
	},
	"error.archive.extension_unsupported": {
		"不支持此局域网控制脚本包扩展名", "Unsupported LAN control script package extension", "不支援此區域網路控制腳本套件副檔名", "この LAN コントロールスクリプトパッケージの拡張子はサポートされていません", "지원되지 않는 LAN 제어 스크립트 패키지 확장자입니다", "Phần mở rộng gói tập lệnh điều khiển LAN không được hỗ trợ", "La extensión del paquete de scripts de control LAN no es compatible", "A extensão do pacote de script de controle LAN não é compatível", "Расширение пакета скрипта управления по LAN не поддерживается", "L’extension du paquet de script de contrôle LAN n’est pas prise en charge", "Die Erweiterung des LAN-Steuerskriptpakets wird nicht unterstützt",
	},
	"error.archive.file_required": {
		"请选择局域网控制脚本包文件", "A LAN control script package file is required", "請選擇區域網路控制腳本套件檔案", "LAN コントロールスクリプトパッケージを選択してください", "LAN 제어 스크립트 패키지 파일이 필요합니다", "Cần chọn tệp gói tập lệnh điều khiển LAN", "Se requiere un archivo de paquete de scripts de control LAN", "É necessário selecionar um pacote de script de controle LAN", "Требуется файл пакета скрипта управления по LAN", "Un fichier de paquet de script de contrôle LAN est requis", "Eine LAN-Steuerskriptpaketdatei ist erforderlich",
	},
	"error.archive.too_large": {
		"局域网控制脚本包过大", "The LAN control script package is too large", "區域網路控制腳本套件過大", "LAN コントロールスクリプトパッケージが大きすぎます", "LAN 제어 스크립트 패키지가 너무 큽니다", "Gói tập lệnh điều khiển LAN quá lớn", "El paquete de scripts de control LAN es demasiado grande", "O pacote de script de controle LAN é muito grande", "Пакет скрипта управления по LAN слишком велик", "Le paquet de script de contrôle LAN est trop volumineux", "Das LAN-Steuerskriptpaket ist zu groß",
	},
	"error.archive.install_name_invalid": {
		"安装名称无效", "Invalid installation name", "安裝名稱無效", "インストール名が無効です", "설치 이름이 잘못되었습니다", "Tên cài đặt không hợp lệ", "El nombre de instalación no es válido", "Nome de instalação inválido", "Недопустимое имя установки", "Nom d’installation non valide", "Ungültiger Installationsname",
	},
	"error.archive.invalid": {
		"局域网控制脚本包无效", "Invalid LAN control script package", "區域網路控制腳本套件無效", "LAN コントロールスクリプトパッケージが無効です", "LAN 제어 스크립트 패키지가 잘못되었습니다", "Gói tập lệnh điều khiển LAN không hợp lệ", "El paquete de scripts de control LAN no es válido", "Pacote de script de controle LAN inválido", "Недопустимый пакет скрипта управления по LAN", "Paquet de script de contrôle LAN non valide", "Ungültiges LAN-Steuerskriptpaket",
	},
	"error.archive.symlink_forbidden": {
		"局域网控制脚本包不能包含符号链接", "The LAN control script package must not contain symbolic links", "區域網路控制腳本套件不能包含符號連結", "LAN コントロールスクリプトパッケージにシンボリックリンクを含めることはできません", "LAN 제어 스크립트 패키지에는 심볼릭 링크를 포함할 수 없습니다", "Gói tập lệnh điều khiển LAN không được chứa liên kết tượng trưng", "El paquete de scripts de control LAN no puede contener enlaces simbólicos", "O pacote de script de controle LAN não pode conter links simbólicos", "Пакет скрипта управления по LAN не должен содержать символические ссылки", "Le paquet de script de contrôle LAN ne doit pas contenir de liens symboliques", "Das LAN-Steuerskriptpaket darf keine Symlinks enthalten",
	},
	"error.archive.unsupported_file": {
		"局域网控制脚本包包含不支持的文件: {file}", "The LAN control script package contains an unsupported file: {file}", "區域網路控制腳本套件包含不支援的檔案：{file}", "LAN コントロールスクリプトパッケージに未対応のファイルが含まれています: {file}", "LAN 제어 스크립트 패키지에 지원되지 않는 파일이 있습니다: {file}", "Gói tập lệnh điều khiển LAN chứa tệp không được hỗ trợ: {file}", "El paquete de scripts de control LAN contiene un archivo no compatible: {file}", "O pacote de script de controle LAN contém um arquivo não compatível: {file}", "Пакет скрипта управления по LAN содержит неподдерживаемый файл: {file}", "Le paquet de script de contrôle LAN contient un fichier non pris en charge : {file}", "Das LAN-Steuerskriptpaket enthält eine nicht unterstützte Datei: {file}",
	},
	"error.archive.duplicate_file": {
		"局域网控制脚本包包含重复文件: {file}", "The LAN control script package contains a duplicate file: {file}", "區域網路控制腳本套件包含重複檔案：{file}", "LAN コントロールスクリプトパッケージに重複したファイルがあります: {file}", "LAN 제어 스크립트 패키지에 중복 파일이 있습니다: {file}", "Gói tập lệnh điều khiển LAN chứa tệp trùng lặp: {file}", "El paquete de scripts de control LAN contiene un archivo duplicado: {file}", "O pacote de script de controle LAN contém um arquivo duplicado: {file}", "Пакет скрипта управления по LAN содержит дублирующийся файл: {file}", "Le paquet de script de contrôle LAN contient un fichier en double : {file}", "Das LAN-Steuerskriptpaket enthält eine doppelte Datei: {file}",
	},
	"error.archive.too_many_files": {
		"局域网控制脚本包包含过多文件", "The LAN control script package contains too many files", "區域網路控制腳本套件包含過多檔案", "LAN コントロールスクリプトパッケージに含まれるファイルが多すぎます", "LAN 제어 스크립트 패키지에 파일이 너무 많습니다", "Gói tập lệnh điều khiển LAN chứa quá nhiều tệp", "El paquete de scripts de control LAN contiene demasiados archivos", "O pacote de script de controle LAN contém arquivos demais", "Пакет скрипта управления по LAN содержит слишком много файлов", "Le paquet de script de contrôle LAN contient trop de fichiers", "Das LAN-Steuerskriptpaket enthält zu viele Dateien",
	},
	"error.archive.entry_too_large": {
		"局域网控制脚本包中的文件过大: {file}", "A file in the LAN control script package is too large: {file}", "區域網路控制腳本套件中的檔案過大：{file}", "LAN コントロールスクリプトパッケージ内のファイルが大きすぎます: {file}", "LAN 제어 스크립트 패키지의 파일이 너무 큽니다: {file}", "Một tệp trong gói tập lệnh điều khiển LAN quá lớn: {file}", "Un archivo del paquete de scripts de control LAN es demasiado grande: {file}", "Um arquivo do pacote de script de controle LAN é muito grande: {file}", "Файл в пакете скрипта управления по LAN слишком велик: {file}", "Un fichier du paquet de script de contrôle LAN est trop volumineux : {file}", "Eine Datei im LAN-Steuerskriptpaket ist zu groß: {file}",
	},
	"error.archive.metadata_invalid": {
		"局域网控制脚本包元数据无效", "Invalid LAN control script package metadata", "區域網路控制腳本套件中繼資料無效", "LAN コントロールスクリプトパッケージのメタデータが無効です", "LAN 제어 스크립트 패키지 메타데이터가 잘못되었습니다", "Siêu dữ liệu gói tập lệnh điều khiển LAN không hợp lệ", "Los metadatos del paquete de scripts de control LAN no son válidos", "Metadados do pacote de script de controle LAN inválidos", "Недопустимые метаданные пакета скрипта управления по LAN", "Métadonnées du paquet de script de contrôle LAN non valides", "Ungültige Metadaten des LAN-Steuerskriptpakets",
	},
	"error.archive.format_unsupported": {
		"不支持此局域网控制脚本包格式", "Unsupported LAN control script package format", "不支援此區域網路控制腳本套件格式", "この LAN コントロールスクリプトパッケージ形式はサポートされていません", "지원되지 않는 LAN 제어 스크립트 패키지 형식입니다", "Định dạng gói tập lệnh điều khiển LAN không được hỗ trợ", "El formato del paquete de scripts de control LAN no es compatible", "O formato do pacote de script de controle LAN não é compatível", "Формат пакета скрипта управления по LAN не поддерживается", "Le format du paquet de script de contrôle LAN n’est pas pris en charge", "Das Format des LAN-Steuerskriptpakets wird nicht unterstützt",
	},
	"error.archive.version_unsupported": {
		"不支持此局域网控制脚本包版本", "Unsupported LAN control script package version", "不支援此區域網路控制腳本套件版本", "この LAN コントロールスクリプトパッケージのバージョンはサポートされていません", "지원되지 않는 LAN 제어 스크립트 패키지 버전입니다", "Phiên bản gói tập lệnh điều khiển LAN không được hỗ trợ", "La versión del paquete de scripts de control LAN no es compatible", "A versão do pacote de script de controle LAN não é compatível", "Версия пакета скрипта управления по LAN не поддерживается", "La version du paquet de script de contrôle LAN n’est pas prise en charge", "Die Version des LAN-Steuerskriptpakets wird nicht unterstützt",
	},
	"error.archive.runtime_missing": {
		"局域网控制脚本包缺少运行文件", "The LAN control script package is missing its runtime file", "區域網路控制腳本套件缺少執行階段檔案", "LAN コントロールスクリプトパッケージにランタイムファイルがありません", "LAN 제어 스크립트 패키지에 런타임 파일이 없습니다", "Gói tập lệnh điều khiển LAN thiếu tệp runtime", "Falta el archivo de tiempo de ejecución del paquete de scripts de control LAN", "O pacote de script de controle LAN não contém o arquivo de runtime", "В пакете скрипта управления по LAN отсутствует файл среды выполнения", "Le paquet de script de contrôle LAN ne contient pas le fichier runtime", "Die Laufzeitdatei fehlt im LAN-Steuerskriptpaket",
	},
	"error.archive.controller_range_invalid": {
		"脚本包要求的控制端版本范围无效", "The controller version range required by the script package is invalid", "腳本套件要求的控制端版本範圍無效", "スクリプトパッケージが要求するコントローラーのバージョン範囲が無効です", "스크립트 패키지의 컨트롤러 버전 범위가 잘못되었습니다", "Khoảng phiên bản bộ điều khiển mà gói tập lệnh yêu cầu không hợp lệ", "El intervalo de versiones del controlador requerido por el paquete no es válido", "O intervalo de versões do controlador exigido pelo pacote é inválido", "Недопустимый диапазон версий контроллера в пакете скрипта", "La plage de versions du contrôleur exigée par le paquet est incorrecte", "Der vom Skriptpaket geforderte Controller-Versionsbereich ist ungültig",
	},
	"error.archive.controller_too_old": {
		"此脚本包要求控制端版本不低于 {required}（当前 {current}）", "This script package requires controller version {required} or later (current: {current})", "此腳本套件要求控制端版本不低於 {required}（目前為 {current}）", "このスクリプトパッケージにはコントローラー {required} 以降が必要です（現在: {current}）", "이 스크립트 패키지에는 컨트롤러 {required} 이상이 필요합니다(현재: {current})", "Gói tập lệnh này yêu cầu bộ điều khiển phiên bản {required} trở lên (hiện tại: {current})", "Este paquete requiere la versión {required} o posterior del controlador (actual: {current})", "Este pacote exige a versão {required} ou posterior do controlador (atual: {current})", "Пакету требуется контроллер версии {required} или новее (текущая: {current})", "Ce paquet nécessite la version {required} ou ultérieure du contrôleur (actuelle : {current})", "Dieses Paket erfordert Controller-Version {required} oder neuer (aktuell: {current})",
	},
	"error.archive.controller_too_new": {
		"此脚本包要求控制端版本不高于 {required}（当前 {current}）", "This script package requires controller version {required} or earlier (current: {current})", "此腳本套件要求控制端版本不高於 {required}（目前為 {current}）", "このスクリプトパッケージにはコントローラー {required} 以前が必要です（現在: {current}）", "이 스크립트 패키지에는 컨트롤러 {required} 이하가 필요합니다(현재: {current})", "Gói tập lệnh này yêu cầu bộ điều khiển phiên bản {required} trở xuống (hiện tại: {current})", "Este paquete requiere la versión {required} o anterior del controlador (actual: {current})", "Este pacote exige a versão {required} ou anterior do controlador (atual: {current})", "Пакету требуется контроллер версии {required} или старее (текущая: {current})", "Ce paquet nécessite la version {required} ou antérieure du contrôleur (actuelle : {current})", "Dieses Paket erfordert Controller-Version {required} oder älter (aktuell: {current})",
	},
	"error.archive.invalid_path": {
		"局域网控制脚本包包含无效路径: {path}", "The LAN control script package contains an invalid path: {path}", "區域網路控制腳本套件包含無效路徑：{path}", "LAN コントロールスクリプトパッケージに無効なパスが含まれています: {path}", "LAN 제어 스크립트 패키지에 잘못된 경로가 있습니다: {path}", "Gói tập lệnh điều khiển LAN chứa đường dẫn không hợp lệ: {path}", "El paquete de scripts de control LAN contiene una ruta no válida: {path}", "O pacote de script de controle LAN contém um caminho inválido: {path}", "Пакет скрипта управления по LAN содержит недопустимый путь: {path}", "Le paquet de script de contrôle LAN contient un chemin non valide : {path}", "Das LAN-Steuerskriptpaket enthält einen ungültigen Pfad: {path}",
	},
	"error.archive.script_exists": {
		"脚本“{name}”已存在", "Script “{name}” already exists", "腳本「{name}」已存在", "スクリプト「{name}」は既に存在します", "스크립트 '{name}'이(가) 이미 있습니다", "Tập lệnh “{name}” đã tồn tại", "El script «{name}» ya existe", "O script “{name}” já existe", "Скрипт «{name}» уже существует", "Le script « {name} » existe déjà", "Das Skript „{name}“ ist bereits vorhanden",
	},
	"error.update.disabled": {
		"更新功能已禁用", "Updates are disabled", "更新功能已停用", "更新は無効になっています", "업데이트가 비활성화되어 있습니다", "Tính năng cập nhật đã bị tắt", "Las actualizaciones están desactivadas", "As atualizações estão desativadas", "Обновления отключены", "Les mises à jour sont désactivées", "Updates sind deaktiviert",
	},
	"error.update.download_in_progress": {
		"正在下载更新", "An update download is already in progress", "更新下載已在進行中", "更新のダウンロードはすでに進行中です", "업데이트를 이미 다운로드하고 있습니다", "Một bản cập nhật đang được tải xuống", "Ya hay una descarga de actualización en curso", "Uma atualização já está sendo baixada", "Загрузка обновления уже выполняется", "Une mise à jour est déjà en cours de téléchargement", "Eine Aktualisierung wird bereits heruntergeladen",
	},
	"error.update.no_update_available": {
		"当前没有可用更新", "No update is available", "目前沒有可用更新", "利用可能な更新はありません", "사용 가능한 업데이트가 없습니다", "Không có bản cập nhật khả dụng", "No hay ninguna actualización disponible", "Nenhuma atualização está disponível", "Нет доступных обновлений", "Aucune mise à jour n’est disponible", "Es ist kein Update verfügbar",
	},
	"error.update.no_active_download": {
		"当前没有正在进行的下载", "There is no active download", "目前沒有進行中的下載", "進行中のダウンロードはありません", "진행 중인 다운로드가 없습니다", "Không có lượt tải xuống nào đang diễn ra", "No hay ninguna descarga activa", "Não há download ativo", "Нет активной загрузки", "Aucun téléchargement n’est en cours", "Es ist kein Download aktiv",
	},
	"error.update.no_downloaded_update": {
		"没有可应用的已下载更新", "There is no downloaded update to apply", "沒有可套用的已下載更新", "適用できるダウンロード済み更新はありません", "적용할 다운로드된 업데이트가 없습니다", "Không có bản cập nhật đã tải xuống để áp dụng", "No hay ninguna actualización descargada que aplicar", "Não há atualização baixada para aplicar", "Нет загруженного обновления для применения", "Aucune mise à jour téléchargée à appliquer", "Es ist kein heruntergeladenes Update zum Anwenden vorhanden",
	},
	"error.update.check_failed": {
		"检查更新失败", "Failed to check for updates", "檢查更新失敗", "更新を確認できませんでした", "업데이트를 확인하지 못했습니다", "Không thể kiểm tra bản cập nhật", "No se han podido buscar actualizaciones", "Não foi possível verificar se há atualizações", "Не удалось проверить обновления", "Échec de la recherche de mises à jour", "Die Suche nach Updates ist fehlgeschlagen",
	},
	"error.update.download_failed": {
		"下载更新失败", "Failed to download the update", "下載更新失敗", "更新をダウンロードできませんでした", "업데이트를 다운로드하지 못했습니다", "Không thể tải bản cập nhật xuống", "No se ha podido descargar la actualización", "Não foi possível baixar a atualização", "Не удалось загрузить обновление", "Échec du téléchargement de la mise à jour", "Das Update konnte nicht heruntergeladen werden",
	},
	"error.update.download_canceled": {
		"更新下载已取消", "The update download was canceled", "更新下載已取消", "更新のダウンロードはキャンセルされました", "업데이트 다운로드가 취소되었습니다", "Đã hủy tải bản cập nhật", "Se ha cancelado la descarga de la actualización", "O download da atualização foi cancelado", "Загрузка обновления отменена", "Le téléchargement de la mise à jour a été annulé", "Der Update-Download wurde abgebrochen",
	},
	"error.update.apply_failed": {
		"应用更新失败", "Failed to apply the update", "套用更新失敗", "更新を適用できませんでした", "업데이트를 적용하지 못했습니다", "Không thể áp dụng bản cập nhật", "No se ha podido aplicar la actualización", "Não foi possível aplicar a atualização", "Не удалось применить обновление", "Échec de l’application de la mise à jour", "Das Update konnte nicht angewendet werden",
	},
	"error.update.previous_apply_retry": {
		"上次应用更新未完成，请重试应用更新", "The previous update was not completed. Try applying it again.", "上次套用更新未完成，請重試套用更新", "前回の更新が完了しませんでした。もう一度適用してください。", "이전 업데이트가 완료되지 않았습니다. 다시 적용해 주세요.", "Lần cập nhật trước chưa hoàn tất. Hãy thử áp dụng lại.", "La actualización anterior no se completó. Intenta aplicarla de nuevo.", "A atualização anterior não foi concluída. Tente aplicá-la novamente.", "Предыдущее обновление не было завершено. Повторите применение.", "La mise à jour précédente ne s’est pas terminée. Réessayez de l’appliquer.", "Das vorherige Update wurde nicht abgeschlossen. Wenden Sie es erneut an.",
	},
	"error.update.previous_apply_redownload": {
		"上次应用更新未完成，请重新下载后再试", "The previous update was not completed. Download it again and retry.", "上次套用更新未完成，請重新下載後再試", "前回の更新が完了しませんでした。再度ダウンロードしてからお試しください。", "이전 업데이트가 완료되지 않았습니다. 다시 다운로드한 후 시도해 주세요.", "Lần cập nhật trước chưa hoàn tất. Hãy tải lại rồi thử lại.", "La actualización anterior no se completó. Vuelve a descargarla e inténtalo de nuevo.", "A atualização anterior não foi concluída. Baixe-a novamente e tente outra vez.", "Предыдущее обновление не было завершено. Загрузите его снова и повторите попытку.", "La mise à jour précédente ne s’est pas terminée. Téléchargez-la de nouveau puis réessayez.", "Das vorherige Update wurde nicht abgeschlossen. Laden Sie es erneut herunter und versuchen Sie es noch einmal.",
	},
	"error.update.docker_readonly": {
		"Docker 文件系统不可写，请拉取新镜像并重建容器完成更新", "The Docker file system is read-only. Pull the new image and recreate the container to update.", "Docker 檔案系統不可寫入，請拉取新映像並重建容器以完成更新", "Docker ファイルシステムに書き込めません。新しいイメージを取得してコンテナを再作成してください。", "Docker 파일 시스템에 쓸 수 없습니다. 새 이미지를 가져와 컨테이너를 다시 생성하세요.", "Không thể ghi vào hệ thống tệp Docker. Hãy kéo image mới và tạo lại container.", "No se puede escribir en el sistema de archivos de Docker. Descarga la imagen nueva y vuelve a crear el contenedor.", "Não é possível gravar no sistema de arquivos do Docker. Baixe a nova imagem e recrie o contêiner.", "Файловая система Docker доступна только для чтения. Получите новый образ и пересоздайте контейнер.", "Le système de fichiers Docker est en lecture seule. Récupérez la nouvelle image et recréez le conteneur.", "Das Docker-Dateisystem ist schreibgeschützt. Laden Sie das neue Image und erstellen Sie den Container neu.",
	},
	"error.app_settings.save_failed": {
		"保存应用设置失败", "Failed to save application settings", "儲存應用程式設定失敗", "アプリ設定を保存できませんでした", "앱 설정을 저장하지 못했습니다", "Không thể lưu cài đặt ứng dụng", "No se han podido guardar los ajustes de la aplicación", "Não foi possível salvar as configurações do aplicativo", "Не удалось сохранить настройки приложения", "Échec de l’enregistrement des paramètres de l’application", "Die Anwendungseinstellungen konnten nicht gespeichert werden",
	},
	"error.debug.device_not_found": {
		"设备不存在", "Device not found", "找不到裝置", "デバイスが見つかりません", "기기를 찾을 수 없습니다", "Không tìm thấy thiết bị", "No se ha encontrado el dispositivo", "Dispositivo não encontrado", "Устройство не найдено", "Appareil introuvable", "Gerät nicht gefunden",
	},
	"error.debug.unsupported": {
		"设备云控客户端不支持调试通道", "The device cloud-control client does not support the debug tunnel", "裝置雲端控制用戶端不支援偵錯通道", "デバイスのクラウド制御クライアントはデバッグトンネルに対応していません", "기기 클라우드 제어 클라이언트가 디버그 터널을 지원하지 않습니다", "Ứng dụng điều khiển đám mây trên thiết bị không hỗ trợ kênh gỡ lỗi", "El cliente de control en la nube del dispositivo no admite el túnel de depuración", "O cliente de controle em nuvem do dispositivo não oferece suporte ao túnel de depuração", "Клиент облачного управления устройства не поддерживает отладочный туннель", "Le client de contrôle cloud de l’appareil ne prend pas en charge le tunnel de débogage", "Der Cloud-Control-Client des Geräts unterstützt den Debug-Tunnel nicht",
	},
	"error.debug.request_id_failed": {
		"创建请求 ID 失败", "Failed to create a request ID", "建立請求 ID 失敗", "リクエスト ID を作成できませんでした", "요청 ID를 만들지 못했습니다", "Không thể tạo ID yêu cầu", "No se ha podido crear un ID de solicitud", "Não foi possível criar um ID de solicitação", "Не удалось создать ID запроса", "Échec de la création d’un ID de requête", "Es konnte keine Anfrage-ID erstellt werden",
	},
	"error.debug.request_failed": {
		"请求设备调试通道失败", "Failed to request the device debug tunnel", "要求裝置偵錯通道失敗", "デバイスのデバッグトンネルを要求できませんでした", "기기 디버그 터널을 요청하지 못했습니다", "Không thể yêu cầu kênh gỡ lỗi của thiết bị", "No se ha podido solicitar el túnel de depuración del dispositivo", "Não foi possível solicitar o túnel de depuração do dispositivo", "Не удалось запросить отладочный туннель устройства", "Échec de la demande du tunnel de débogage de l’appareil", "Der Debug-Tunnel des Geräts konnte nicht angefordert werden",
	},
	"bind.version_unsupported": {
		"该脚本仅支持 XXT {version} 或更高版本", "This script requires XXT {version} or later.", "此腳本僅支援 XXT {version} 或更高版本", "このスクリプトには XXT {version} 以降が必要です。", "이 스크립트에는 XXT {version} 이상이 필요합니다.", "Tập lệnh này yêu cầu XXT {version} trở lên.", "Este script requiere XXT {version} o posterior.", "Este script exige o XXT {version} ou posterior.", "Для этого скрипта требуется XXT {version} или новее.", "Ce script nécessite XXT {version} ou une version ultérieure.", "Dieses Skript erfordert XXT {version} oder neuer.",
	},
	"bind.unbind_prompt": {
		"当前设备已被以下云控控制：\n\n{address}\n\n是否解除设备的被控状态？", "This device is currently controlled by:\n\n{address}\n\nDo you want to unbind it from this cloud control?", "目前裝置受以下雲端控制：\n\n{address}\n\n是否解除裝置的受控狀態？", "このデバイスは現在、次のクラウドコントロールによって制御されています。\n\n{address}\n\nバインドを解除しますか？", "이 기기는 현재 다음 클라우드 제어의 제어를 받고 있습니다.\n\n{address}\n\n바인딩을 해제하시겠습니까?", "Thiết bị này hiện đang được điều khiển bởi:\n\n{address}\n\nBạn có muốn hủy liên kết khỏi hệ thống điều khiển này không?", "Este dispositivo está controlado actualmente por:\n\n{address}\n\n¿Quieres desvincularlo de este control en la nube?", "Este dispositivo está sendo controlado por:\n\n{address}\n\nDeseja desvinculá-lo deste controle em nuvem?", "Сейчас устройством управляет:\n\n{address}\n\nОтвязать его от этой системы облачного управления?", "Cet appareil est actuellement contrôlé par :\n\n{address}\n\nVoulez-vous le dissocier de ce contrôle cloud ?", "Dieses Gerät wird derzeit von folgender Cloud-Steuerung gesteuert:\n\n{address}\n\nMöchten Sie die Zuordnung zu dieser Cloud-Steuerung aufheben?",
	},
	"bind.unbind_title": {
		"解除云控", "Unbind cloud control", "解除雲端控制", "クラウドコントロールのバインドを解除", "클라우드 제어 바인딩 해제", "Hủy liên kết điều khiển đám mây", "Desvincular control en la nube", "Desvincular controle em nuvem", "Отвязать облачное управление", "Dissocier le contrôle cloud", "Cloud-Zuordnung aufheben",
	},
	"bind.cancel": {
		"取消", "Cancel", "取消", "キャンセル", "취소", "Hủy", "Cancelar", "Cancelar", "Отмена", "Annuler", "Abbrechen",
	},
	"bind.unbind_confirm": {
		"解除", "Unbind", "解除", "バインド解除", "바인딩 해제", "Hủy liên kết", "Desvincular", "Desvincular", "Отвязать", "Dissocier", "Zuordnung aufheben",
	},
	"bind.unbound_success": {
		"已解除云控绑定", "Successfully unbound from cloud control.", "已解除雲端控制綁定", "クラウドコントロールのバインドを解除しました。", "클라우드 제어 바인딩을 해제했습니다.", "Đã hủy liên kết khỏi hệ thống điều khiển đám mây.", "Se ha desvinculado del control en la nube.", "O dispositivo foi desvinculado do controle em nuvem.", "Устройство отвязано от облачного управления.", "L’appareil a été dissocié du contrôle cloud.", "Die Zuordnung zur Cloud-Steuerung wurde aufgehoben.",
	},
	"bind.bind_prompt": {
		"是否将设备加入以下云控？\n\n{address}\n\n⚠️ 请确认该云控可信，否则设备可能被恶意控制！", "Do you want to bind this device to the following cloud control?\n\n{address}\n\n⚠️ Make sure this cloud control is trusted, or the device could be controlled maliciously.", "是否將裝置加入以下雲端控制？\n\n{address}\n\n⚠️ 請確認此雲端控制可信，否則裝置可能遭到惡意控制！", "このデバイスを次のクラウドコントロールにバインドしますか？\n\n{address}\n\n⚠️ 信頼できる接続先であることを確認してください。悪意のある操作を受ける可能性があります。", "이 기기를 다음 클라우드 제어에 바인딩하시겠습니까?\n\n{address}\n\n⚠️ 신뢰할 수 있는 클라우드 제어인지 확인하세요. 그렇지 않으면 기기가 악의적으로 제어될 수 있습니다.", "Bạn có muốn liên kết thiết bị với hệ thống điều khiển đám mây sau không?\n\n{address}\n\n⚠️ Hãy bảo đảm hệ thống này đáng tin cậy, nếu không thiết bị có thể bị điều khiển với mục đích xấu.", "¿Quieres vincular este dispositivo al siguiente control en la nube?\n\n{address}\n\n⚠️ Asegúrate de que sea de confianza; de lo contrario, el dispositivo podría controlarse de forma maliciosa.", "Deseja vincular este dispositivo ao seguinte controle em nuvem?\n\n{address}\n\n⚠️ Verifique se ele é confiável; caso contrário, o dispositivo poderá ser controlado de forma maliciosa.", "Привязать устройство к следующей системе облачного управления?\n\n{address}\n\n⚠️ Убедитесь, что она надёжна, иначе устройство может оказаться под вредоносным управлением.", "Voulez-vous associer cet appareil au contrôle cloud suivant ?\n\n{address}\n\n⚠️ Vérifiez qu’il est digne de confiance, sinon l’appareil pourrait être contrôlé de façon malveillante.", "Möchten Sie dieses Gerät der folgenden Cloud-Steuerung zuordnen?\n\n{address}\n\n⚠️ Vergewissern Sie sich, dass sie vertrauenswürdig ist, da das Gerät sonst missbräuchlich gesteuert werden könnte.",
	},
	"bind.bind_title": {
		"加入云控", "Bind cloud control", "加入雲端控制", "クラウドコントロールにバインド", "클라우드 제어 바인딩", "Liên kết điều khiển đám mây", "Vincular control en la nube", "Vincular controle em nuvem", "Привязать облачное управление", "Associer le contrôle cloud", "Cloud-Steuerung zuordnen",
	},
	"bind.bind_confirm": {
		"加入并授权控制", "Bind and allow control", "加入並授權控制", "バインドして制御を許可", "바인딩 및 제어 허용", "Liên kết và cho phép điều khiển", "Vincular y permitir el control", "Vincular e permitir o controle", "Привязать и разрешить управление", "Associer et autoriser le contrôle", "Zuordnen und Steuerung zulassen",
	},
	"bind.bound_success": {
		"已绑定到云控", "Successfully bound to cloud control.", "已綁定至雲端控制", "クラウドコントロールにバインドしました。", "클라우드 제어에 바인딩했습니다.", "Đã liên kết với hệ thống điều khiển đám mây.", "Se ha vinculado al control en la nube.", "O dispositivo foi vinculado ao controle em nuvem.", "Устройство привязано к облачному управлению.", "L’appareil a été associé au contrôle cloud.", "Das Gerät wurde der Cloud-Steuerung zugeordnet.",
	},
}
