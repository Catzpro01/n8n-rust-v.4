// Built-in node catalog — typed backend boundary (Agent 2).
//
// Node Model LEGO contribution to the Native Multi-Locale wave: the
// human-facing metadata of the core built-in node types, expressed natively
// in the six official locales and registered through the
// `registerTranslations(locale, catalog)` seam (Agent 1).
//
// This module is the TypeScript twin of
// `packages/reconstructed-engine/node-catalog.mjs`; a drift test
// (`test/06-node-catalog.test.mjs`) keeps the two key/value sets identical.
//
// Ground truth for the English source text is the pinned n8n 2.9.4 reference
// runtime (`n8n-nodes-base/dist/types/nodes.json`). The reference tree is
// never modified.

import {
  NativeLocalizationService,
  SUPPORTED_LOCALE_CODES,
  type LocaleInput,
  type SupportedLocale,
  type TranslationParameters,
} from './backend-localization-service';

export const BUILTIN_NODE_PREFIX = 'n8n-nodes-base.';

export const BUILTIN_NODE_ALIASES = [
  'manualTrigger',
  'webhook',
  'scheduleTrigger',
  'cron',
  'if',
  'switch',
  'merge',
  'splitInBatches',
  'noOp',
  'code',
  'set',
  'httpRequest',
  'respondToWebhook',
  'executeWorkflow',
  'wait',
] as const;

export type BuiltinNodeAlias = (typeof BUILTIN_NODE_ALIASES)[number];

/** Strip the built-in package prefix and return the node type alias. */
export function nodeAliasOf(type: unknown): string | null {
  if (typeof type !== 'string') return null;
  const trimmed = type.trim();
  if (!trimmed) return null;
  return trimmed.startsWith(BUILTIN_NODE_PREFIX) ? trimmed.slice(BUILTIN_NODE_PREFIX.length) : trimmed;
}

const EN_CATALOG: Readonly<Record<string, string>> = {
  'node.manualTrigger.label': 'Manual Trigger',
  'node.manualTrigger.description': 'Runs the flow on clicking a button in n8n',
  'node.webhook.label': 'Webhook',
  'node.webhook.description': 'Starts the workflow when a webhook is called',
  'node.webhook.parameters.multipleMethods': 'Allow Multiple HTTP Methods',
  'node.webhook.parameters.httpMethod': 'HTTP Method',
  'node.webhook.parameters.path': 'Path',
  'node.webhook.parameters.authentication': 'Authentication',
  'node.webhook.parameters.responseMode': 'Respond',
  'node.scheduleTrigger.label': 'Schedule Trigger',
  'node.scheduleTrigger.description': 'Triggers the workflow on a given schedule',
  'node.scheduleTrigger.parameters.rule': 'Trigger Rules',
  'node.cron.label': 'Cron',
  'node.cron.description': 'Triggers the workflow at a specific time',
  'node.cron.parameters.triggerTimes': 'Trigger Times',
  'node.if.label': 'If',
  'node.if.description': 'Route items to different branches (true/false)',
  'node.if.parameters.conditions': 'Conditions',
  'node.if.parameters.looseTypeValidation': 'Convert types where required',
  'node.if.parameters.options': 'Options',
  'node.switch.label': 'Switch',
  'node.switch.description': 'Route items depending on defined expression or rules',
  'node.switch.parameters.mode': 'Mode',
  'node.switch.parameters.numberOutputs': 'Number of Outputs',
  'node.switch.parameters.rules': 'Routing Rules',
  'node.merge.label': 'Merge',
  'node.merge.description': 'Merges data of multiple streams once data from both is available',
  'node.merge.parameters.mode': 'Mode',
  'node.merge.parameters.combineBy': 'Combine By',
  'node.merge.parameters.numberInputs': 'Number of Inputs',
  'node.merge.parameters.options': 'Options',
  'node.splitInBatches.label': 'Loop Over Items (Split in Batches)',
  'node.splitInBatches.description': 'Split data into batches and iterate over each batch',
  'node.splitInBatches.parameters.batchSize': 'Batch Size',
  'node.splitInBatches.parameters.options': 'Options',
  'node.noOp.label': 'No Operation, do nothing',
  'node.noOp.description': 'No Operation',
  'node.code.label': 'Code',
  'node.code.description': 'Run custom JavaScript or Python code',
  'node.code.parameters.mode': 'Mode',
  'node.code.parameters.language': 'Language',
  'node.set.label': 'Edit Fields (Set)',
  'node.set.description': 'Modify, add, or remove item fields',
  'node.set.parameters.mode': 'Mode',
  'node.set.parameters.duplicateItem': 'Duplicate Item',
  'node.set.parameters.fields': 'Fields to Set',
  'node.httpRequest.label': 'HTTP Request',
  'node.httpRequest.description': 'Makes an HTTP request and returns the response data',
  'node.httpRequest.parameters.method': 'Method',
  'node.httpRequest.parameters.url': 'URL',
  'node.httpRequest.parameters.authentication': 'Authentication',
  'node.respondToWebhook.label': 'Respond to Webhook',
  'node.respondToWebhook.description': 'Returns data for Webhook',
  'node.respondToWebhook.parameters.enableResponseOutput': 'Enable Response Output Branch',
  'node.respondToWebhook.parameters.respondWith': 'Respond With',
  'node.executeWorkflow.label': 'Execute Sub-workflow',
  'node.executeWorkflow.description': 'Execute another workflow',
  'node.executeWorkflow.parameters.operation': 'Operation',
  'node.executeWorkflow.parameters.source': 'Source',
  'node.executeWorkflow.parameters.workflowId': 'Workflow ID',
  'node.wait.label': 'Wait',
  'node.wait.description': 'Wait before continue with execution',
  'node.wait.parameters.resume': 'Resume',
  'node.wait.parameters.dateTime': 'Date and Time',
  'node.wait.parameters.amount': 'Wait Amount',
};

const ID_CATALOG: Readonly<Record<string, string>> = {
  'node.manualTrigger.label': 'Pemicu Manual',
  'node.manualTrigger.description': 'Menjalankan alur saat tombol pada kanvas diklik',
  'node.webhook.label': 'Webhook',
  'node.webhook.description': 'Memulai alur kerja ketika webhook dipanggil',
  'node.webhook.parameters.multipleMethods': 'Izinkan Metode HTTP Beragam',
  'node.webhook.parameters.httpMethod': 'Metode HTTP',
  'node.webhook.parameters.path': 'Jalur',
  'node.webhook.parameters.authentication': 'Autentikasi',
  'node.webhook.parameters.responseMode': 'Tanggapi',
  'node.scheduleTrigger.label': 'Pemicu Jadwal',
  'node.scheduleTrigger.description': 'Memicu alur kerja sesuai jadwal tertentu',
  'node.scheduleTrigger.parameters.rule': 'Aturan Pemicu',
  'node.cron.label': 'Cron',
  'node.cron.description': 'Memicu alur kerja pada waktu tertentu',
  'node.cron.parameters.triggerTimes': 'Waktu Pemicu',
  'node.if.label': 'Jika',
  'node.if.description': 'Merutekan item ke cabang berbeda (benar/salah)',
  'node.if.parameters.conditions': 'Kondisi',
  'node.if.parameters.looseTypeValidation': 'Konversi tipe jika diperlukan',
  'node.if.parameters.options': 'Opsi',
  'node.switch.label': 'Switch',
  'node.switch.description': 'Merutekan item sesuai ekspresi atau aturan yang didefinisikan',
  'node.switch.parameters.mode': 'Mode',
  'node.switch.parameters.numberOutputs': 'Jumlah Output',
  'node.switch.parameters.rules': 'Aturan Perutekan',
  'node.merge.label': 'Merge',
  'node.merge.description': 'Menggabungkan data beberapa stream setelah data dari keduanya tersedia',
  'node.merge.parameters.mode': 'Mode',
  'node.merge.parameters.combineBy': 'Gabungkan Berdasarkan',
  'node.merge.parameters.numberInputs': 'Jumlah Input',
  'node.merge.parameters.options': 'Opsi',
  'node.splitInBatches.label': 'Ulangi per Item (Pecah ke Batch)',
  'node.splitInBatches.description': 'Membagi data menjadi batch dan mengulang setiap batch',
  'node.splitInBatches.parameters.batchSize': 'Ukuran Batch',
  'node.splitInBatches.parameters.options': 'Opsi',
  'node.noOp.label': 'Tidak Ada Operasi, tidak melakukan apa pun',
  'node.noOp.description': 'Tidak Ada Operasi',
  'node.code.label': 'Kode',
  'node.code.description': 'Menjalankan kode JavaScript atau Python kustom',
  'node.code.parameters.mode': 'Mode',
  'node.code.parameters.language': 'Bahasa',
  'node.set.label': 'Ubah Field (Set)',
  'node.set.description': 'Memodifikasi, menambah, atau menghapus field item',
  'node.set.parameters.mode': 'Mode',
  'node.set.parameters.duplicateItem': 'Duplikasi Item',
  'node.set.parameters.fields': 'Field untuk Diatur',
  'node.httpRequest.label': 'HTTP Request',
  'node.httpRequest.description': 'Membuat permintaan HTTP dan mengembalikan data respons',
  'node.httpRequest.parameters.method': 'Metode',
  'node.httpRequest.parameters.url': 'URL',
  'node.httpRequest.parameters.authentication': 'Autentikasi',
  'node.respondToWebhook.label': 'Tanggapi Webhook',
  'node.respondToWebhook.description': 'Mengembalikan data untuk Webhook',
  'node.respondToWebhook.parameters.enableResponseOutput': 'Aktifkan Cabang Output Respons',
  'node.respondToWebhook.parameters.respondWith': 'Tanggapi Dengan',
  'node.executeWorkflow.label': 'Jalankan Sub-alur Kerja',
  'node.executeWorkflow.description': 'Menjalankan alur kerja lain',
  'node.executeWorkflow.parameters.operation': 'Operasi',
  'node.executeWorkflow.parameters.source': 'Sumber',
  'node.executeWorkflow.parameters.workflowId': 'ID Alur Kerja',
  'node.wait.label': 'Tunggu',
  'node.wait.description': 'Menunggu sebelum melanjutkan eksekusi',
  'node.wait.parameters.resume': 'Lanjutkan',
  'node.wait.parameters.dateTime': 'Tanggal dan Waktu',
  'node.wait.parameters.amount': 'Jumlah Tunggu',
};

const JV_CATALOG: Readonly<Record<string, string>> = {
  'node.manualTrigger.label': 'Pemicu Manual',
  'node.manualTrigger.description': 'Nglakokake alur nalika tombol ing kanvas dituthuk',
  'node.webhook.label': 'Webhook',
  'node.webhook.description': 'Nuwuhake alur kerja nalika webhook dipanggil',
  'node.webhook.parameters.multipleMethods': 'Ijengake Metode HTTP Akeh',
  'node.webhook.parameters.httpMethod': 'Metode HTTP',
  'node.webhook.parameters.path': 'Jalur',
  'node.webhook.parameters.authentication': 'Autentikasi',
  'node.webhook.parameters.responseMode': 'Wangsulna',
  'node.scheduleTrigger.label': 'Pemicu Jadwal',
  'node.scheduleTrigger.description': 'Memicu alur kerja miturut jadwal tartamtu',
  'node.scheduleTrigger.parameters.rule': 'Aturan Pemicu',
  'node.cron.label': 'Cron',
  'node.cron.description': 'Memicu alur kerja ing wektu tartamtu',
  'node.cron.parameters.triggerTimes': 'Wektu Pemicu',
  'node.if.label': 'Yen',
  'node.if.description': 'Nalukake item menyang cabang sing beda (benere/salah)',
  'node.if.parameters.conditions': 'Kondisi',
  'node.if.parameters.looseTypeValidation': 'Ganti Tipe Ingkang Perlu',
  'node.if.parameters.options': 'Pilihan',
  'node.switch.label': 'Switch',
  'node.switch.description': 'Nalukake item miturut ekspresi utawa aturan sing wis didefinisikake',
  'node.switch.parameters.mode': 'Mode',
  'node.switch.parameters.numberOutputs': 'Akeh-ane Output',
  'node.switch.parameters.rules': 'Aturan Lumampahan',
  'node.merge.label': 'Merge',
  'node.merge.description': 'Nganyemak data saka pirang-pirang stream sawise data saka kabehane wis kasedhiya',
  'node.merge.parameters.mode': 'Mode',
  'node.merge.parameters.combineBy': 'Anyemake Miturut',
  'node.merge.parameters.numberInputs': 'Akeh-ane Input',
  'node.merge.parameters.options': 'Pilihan',
  'node.splitInBatches.label': 'Ulangi saben Item (Bagekna dadi Batch)',
  'node.splitInBatches.description': 'Ngagek data dadi batch lan mungkel saben batch',
  'node.splitInBatches.parameters.batchSize': 'Gedhene Batch',
  'node.splitInBatches.parameters.options': 'Pilihan',
  'node.noOp.label': 'Mboten Ana Operasine, Mboten Nindakake Apa-Apa',
  'node.noOp.description': 'Mboten Ana Operasine',
  'node.code.label': 'Kode',
  'node.code.description': 'Nglakokake kode JavaScript utawa Python dhewe',
  'node.code.parameters.mode': 'Mode',
  'node.code.parameters.language': 'Basa',
  'node.set.label': 'Edit Field (Set)',
  'node.set.description': 'Ngganti, nambah, utawa ngilangi field item',
  'node.set.parameters.mode': 'Mode',
  'node.set.parameters.duplicateItem': 'Duplikasi Item',
  'node.set.parameters.fields': 'Field Kanggo Ditetepake',
  'node.httpRequest.label': 'HTTP Request',
  'node.httpRequest.description': 'Nglempangake panguwahan HTTP lan mbaliki data jawaban',
  'node.httpRequest.parameters.method': 'Metode',
  'node.httpRequest.parameters.url': 'URL',
  'node.httpRequest.parameters.authentication': 'Autentikasi',
  'node.respondToWebhook.label': 'Wangsulan Webhook',
  'node.respondToWebhook.description': 'Mbaliki data kanggo Webhook',
  'node.respondToWebhook.parameters.enableResponseOutput': 'Aktifake Cabang Output Jawaban',
  'node.respondToWebhook.parameters.respondWith': 'Wangsulake Kadhua',
  'node.executeWorkflow.label': 'Lakokake Sub-alur Kerja',
  'node.executeWorkflow.description': 'Nglakokake alur kerja liyane',
  'node.executeWorkflow.parameters.operation': 'Operasi',
  'node.executeWorkflow.parameters.source': 'Sumber',
  'node.executeWorkflow.parameters.workflowId': 'ID Alur Kerja',
  'node.wait.label': 'Ngenteni',
  'node.wait.description': 'Ngenteni sadurunge nerusake eksekusi',
  'node.wait.parameters.resume': 'Nerusake',
  'node.wait.parameters.dateTime': 'Dina lan Wektu',
  'node.wait.parameters.amount': 'Jumla Ngenteni',
};

const AR_CATALOG: Readonly<Record<string, string>> = {
  'node.manualTrigger.label': 'المُحفِّز اليدوي',
  'node.manualTrigger.description': 'تنفيذ التدفق عند النقر على زر في اللوحة',
  'node.webhook.label': 'ويب هوك',
  'node.webhook.description': 'بدء سير العمل عند استدعاء الويب هوك',
  'node.webhook.parameters.multipleMethods': 'السماح بعدة طرق HTTP',
  'node.webhook.parameters.httpMethod': 'طريقة HTTP',
  'node.webhook.parameters.path': 'المسار',
  'node.webhook.parameters.authentication': 'المصادقة',
  'node.webhook.parameters.responseMode': 'الرد',
  'node.scheduleTrigger.label': 'مُحفِّز الجدولة',
  'node.scheduleTrigger.description': 'يُشغِّل سير العمل وفق جدول معيّن',
  'node.scheduleTrigger.parameters.rule': 'قواعد التشغيل',
  'node.cron.label': 'Cron (كرون)',
  'node.cron.description': 'يُشغِّل سير العمل في وقت محدد',
  'node.cron.parameters.triggerTimes': 'أوقات التشغيل',
  'node.if.label': 'إذا',
  'node.if.description': 'توجيه العناصر إلى فروع مختلفة (صحيح/خطأ)',
  'node.if.parameters.conditions': 'الشروط',
  'node.if.parameters.looseTypeValidation': 'تحويل الأنواع حيث يلزم',
  'node.if.parameters.options': 'الخيارات',
  'node.switch.label': 'مبدّل',
  'node.switch.description': 'توجيه العناصر حسب التعبير أو القواعد المحددة',
  'node.switch.parameters.mode': 'الوضع',
  'node.switch.parameters.numberOutputs': 'عدد المخرجات',
  'node.switch.parameters.rules': 'قواعد التوجيه',
  'node.merge.label': 'دمج',
  'node.merge.description': 'دمج بيانات عدة تدفقات بمجرد توفر البيانات من الطرفين',
  'node.merge.parameters.mode': 'الوضع',
  'node.merge.parameters.combineBy': 'الدمج حسب',
  'node.merge.parameters.numberInputs': 'عدد المدخلات',
  'node.merge.parameters.options': 'الخيارات',
  'node.splitInBatches.label': 'التكرار على العناصر (التقسيم إلى دفعات)',
  'node.splitInBatches.description': 'تقسيم البيانات إلى دفعات والتكرار على كل دفعة',
  'node.splitInBatches.parameters.batchSize': 'حجم الدفعة',
  'node.splitInBatches.parameters.options': 'الخيارات',
  'node.noOp.label': 'لا عملية، لا يفعل شيئًا',
  'node.noOp.description': 'لا عملية',
  'node.code.label': 'كود',
  'node.code.description': 'تشغيل كود JavaScript أو Python مخصص',
  'node.code.parameters.mode': 'الوضع',
  'node.code.parameters.language': 'اللغة',
  'node.set.label': 'تعديل الحقول (Set)',
  'node.set.description': 'تعديل حقول العناصر أو إضافتها أو إزالتها',
  'node.set.parameters.mode': 'الوضع',
  'node.set.parameters.duplicateItem': 'تكرار العنصر',
  'node.set.parameters.fields': 'الحقول للإعداد',
  'node.httpRequest.label': 'طلب HTTP',
  'node.httpRequest.description': 'إرسال طلب HTTP وإرجاع بيانات الاستجابة',
  'node.httpRequest.parameters.method': 'الطريقة',
  'node.httpRequest.parameters.url': 'العنوان (URL)',
  'node.httpRequest.parameters.authentication': 'المصادقة',
  'node.respondToWebhook.label': 'الرد على الويب هوك',
  'node.respondToWebhook.description': 'إرجاع بيانات للويب هوك',
  'node.respondToWebhook.parameters.enableResponseOutput': 'تفعيل فرع مخرجات الاستجابة',
  'node.respondToWebhook.parameters.respondWith': 'الرد بـ',
  'node.executeWorkflow.label': 'تنفيذ سير عمل فرعي',
  'node.executeWorkflow.description': 'تنفيذ سير عمل آخر',
  'node.executeWorkflow.parameters.operation': 'العملية',
  'node.executeWorkflow.parameters.source': 'المصدر',
  'node.executeWorkflow.parameters.workflowId': 'معرّف سير العمل',
  'node.wait.label': 'انتظار',
  'node.wait.description': 'انتظار قبل المتابعة في التنفيذ',
  'node.wait.parameters.resume': 'الاستئناف',
  'node.wait.parameters.dateTime': 'التاريخ والوقت',
  'node.wait.parameters.amount': 'مدة الانتظار',
};

const ZH_CATALOG: Readonly<Record<string, string>> = {
  'node.manualTrigger.label': '手动触发器',
  'node.manualTrigger.description': '点击画布上的按钮时运行流程',
  'node.webhook.label': 'Webhook',
  'node.webhook.description': '当 Webhook 被调用时启动工作流',
  'node.webhook.parameters.multipleMethods': '允许多种 HTTP 方法',
  'node.webhook.parameters.httpMethod': 'HTTP 方法',
  'node.webhook.parameters.path': '路径',
  'node.webhook.parameters.authentication': '身份验证',
  'node.webhook.parameters.responseMode': '响应',
  'node.scheduleTrigger.label': '计划触发器',
  'node.scheduleTrigger.description': '按计划触发工作流',
  'node.scheduleTrigger.parameters.rule': '触发规则',
  'node.cron.label': 'Cron 定时',
  'node.cron.description': '在特定时间触发工作流',
  'node.cron.parameters.triggerTimes': '触发时间',
  'node.if.label': '如果 (If)',
  'node.if.description': '将条目路由到不同分支（真/假）',
  'node.if.parameters.conditions': '条件',
  'node.if.parameters.looseTypeValidation': '在必要时转换类型',
  'node.if.parameters.options': '选项',
  'node.switch.label': '分支 (Switch)',
  'node.switch.description': '根据定义的表达式或规则路由条目',
  'node.switch.parameters.mode': '模式',
  'node.switch.parameters.numberOutputs': '输出数量',
  'node.switch.parameters.rules': '路由规则',
  'node.merge.label': '合并 (Merge)',
  'node.merge.description': '当两个数据流的数据都可用时合并多条数据流',
  'node.merge.parameters.mode': '模式',
  'node.merge.parameters.combineBy': '合并方式',
  'node.merge.parameters.numberInputs': '输入数量',
  'node.merge.parameters.options': '选项',
  'node.splitInBatches.label': '逐项循环（分批拆分）',
  'node.splitInBatches.description': '将数据拆分为批次并依次处理每个批次',
  'node.splitInBatches.parameters.batchSize': '批次大小',
  'node.splitInBatches.parameters.options': '选项',
  'node.noOp.label': '无操作，什么都不做',
  'node.noOp.description': '无操作',
  'node.code.label': '代码',
  'node.code.description': '运行自定义 JavaScript 或 Python 代码',
  'node.code.parameters.mode': '模式',
  'node.code.parameters.language': '语言',
  'node.set.label': '编辑字段 (Set)',
  'node.set.description': '修改、添加或删除条目的字段',
  'node.set.parameters.mode': '模式',
  'node.set.parameters.duplicateItem': '复制条目',
  'node.set.parameters.fields': '要设置的字段',
  'node.httpRequest.label': 'HTTP 请求',
  'node.httpRequest.description': '发送 HTTP 请求并返回响应数据',
  'node.httpRequest.parameters.method': '方法',
  'node.httpRequest.parameters.url': 'URL 地址',
  'node.httpRequest.parameters.authentication': '身份验证',
  'node.respondToWebhook.label': '响应 Webhook',
  'node.respondToWebhook.description': '为 Webhook 返回数据',
  'node.respondToWebhook.parameters.enableResponseOutput': '启用响应输出分支',
  'node.respondToWebhook.parameters.respondWith': '响应内容',
  'node.executeWorkflow.label': '执行子工作流',
  'node.executeWorkflow.description': '执行另一个工作流',
  'node.executeWorkflow.parameters.operation': '操作',
  'node.executeWorkflow.parameters.source': '来源',
  'node.executeWorkflow.parameters.workflowId': '工作流 ID',
  'node.wait.label': '等待',
  'node.wait.description': '继续执行前等待',
  'node.wait.parameters.resume': '恢复',
  'node.wait.parameters.dateTime': '日期和时间',
  'node.wait.parameters.amount': '等待时长',
};

const RU_CATALOG: Readonly<Record<string, string>> = {
  'node.manualTrigger.label': 'Ручной запуск',
  'node.manualTrigger.description': 'Запускает процесс при нажатии кнопки на холсте',
  'node.webhook.label': 'Вебхук',
  'node.webhook.description': 'Запускает процесс при обращении к вебхуку',
  'node.webhook.parameters.multipleMethods': 'Разрешить несколько методов HTTP',
  'node.webhook.parameters.httpMethod': 'Метод HTTP',
  'node.webhook.parameters.path': 'Путь',
  'node.webhook.parameters.authentication': 'Аутентификация',
  'node.webhook.parameters.responseMode': 'Ответить',
  'node.scheduleTrigger.label': 'Запуск по расписанию',
  'node.scheduleTrigger.description': 'Запускает процесс по заданному расписанию',
  'node.scheduleTrigger.parameters.rule': 'Правила запуска',
  'node.cron.label': 'Cron',
  'node.cron.description': 'Запускает процесс в заданное время',
  'node.cron.parameters.triggerTimes': 'Время запуска',
  'node.if.label': 'Условие (If)',
  'node.if.description': 'Направляет элементы в разные ветви (истина/ложь)',
  'node.if.parameters.conditions': 'Условия',
  'node.if.parameters.looseTypeValidation': 'Преобразовывать типы при необходимости',
  'node.if.parameters.options': 'Варианты',
  'node.switch.label': 'Переключатель',
  'node.switch.description': 'Направляет элементы по выражению или правилам',
  'node.switch.parameters.mode': 'Режим',
  'node.switch.parameters.numberOutputs': 'Количество выходов',
  'node.switch.parameters.rules': 'Правила маршрутизации',
  'node.merge.label': 'Слияние',
  'node.merge.description': 'Объединяет данные нескольких потоков, когда данные из обоих доступны',
  'node.merge.parameters.mode': 'Режим',
  'node.merge.parameters.combineBy': 'Объединять по',
  'node.merge.parameters.numberInputs': 'Количество входов',
  'node.merge.parameters.options': 'Варианты',
  'node.splitInBatches.label': 'Цикл по элементам (по частям)',
  'node.splitInBatches.description': 'Разбивает данные на части и проходит по каждой',
  'node.splitInBatches.parameters.batchSize': 'Размер партии',
  'node.splitInBatches.parameters.options': 'Варианты',
  'node.noOp.label': 'Без операции, ничего не делает',
  'node.noOp.description': 'Без операции',
  'node.code.label': 'Код',
  'node.code.description': 'Выполняет собственный JavaScript или Python код',
  'node.code.parameters.mode': 'Режим',
  'node.code.parameters.language': 'Язык',
  'node.set.label': 'Изменить поля (Set)',
  'node.set.description': 'Изменяет, добавляет или удаляет поля элементов',
  'node.set.parameters.mode': 'Режим',
  'node.set.parameters.duplicateItem': 'Дублировать элемент',
  'node.set.parameters.fields': 'Поля для установки',
  'node.httpRequest.label': 'HTTP запрос',
  'node.httpRequest.description': 'Делает HTTP запрос и возвращает данные ответа',
  'node.httpRequest.parameters.method': 'Метод',
  'node.httpRequest.parameters.url': 'URL',
  'node.httpRequest.parameters.authentication': 'Аутентификация',
  'node.respondToWebhook.label': 'Ответить на вебхук',
  'node.respondToWebhook.description': 'Возвращает данные для вебхука',
  'node.respondToWebhook.parameters.enableResponseOutput': 'Включить ветку вывода ответа',
  'node.respondToWebhook.parameters.respondWith': 'Ответить с',
  'node.executeWorkflow.label': 'Выполнить подпроцесс',
  'node.executeWorkflow.description': 'Выполняет другой процесс',
  'node.executeWorkflow.parameters.operation': 'Операция',
  'node.executeWorkflow.parameters.source': 'Источник',
  'node.executeWorkflow.parameters.workflowId': 'ID процесса',
  'node.wait.label': 'Ожидание',
  'node.wait.description': 'Пауза перед продолжением выполнения',
  'node.wait.parameters.resume': 'Возобновить',
  'node.wait.parameters.dateTime': 'Дата и время',
  'node.wait.parameters.amount': 'Длительность ожидания',
};

const RAW_LOCALE_CATALOGS: Readonly<Record<SupportedLocale, Readonly<Record<string, string>>>> = {
  id: ID_CATALOG,
  jv: JV_CATALOG,
  ar: AR_CATALOG,
  zh: ZH_CATALOG,
  ru: RU_CATALOG,
  en: EN_CATALOG,
};

/**
 * Build the registration catalog for a locale: the canonical keys plus value
 * aliases (English source text -> native text) derived from the English
 * catalog, so payloads carrying English source values are localized too.
 */
function withValueAliases(en: Readonly<Record<string, string>>, localized: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const out: Record<string, string> = { ...localized };
  for (const [key, nativeText] of Object.entries(localized)) {
    const enText = en[key];
    if (enText && enText !== nativeText && !Object.prototype.hasOwnProperty.call(out, enText)) {
      out[enText] = nativeText;
    }
  }
  return out;
}

/**
 * The full built-in node registration catalog for every official locale.
 * Keys prefixed `node.` are canonical; other keys are value aliases mapping
 * the English source text to the native text.
 */
export const BUILTIN_NODE_CATALOG: Readonly<Record<SupportedLocale, Readonly<Record<string, string>>>> = {
  id: withValueAliases(EN_CATALOG, ID_CATALOG),
  jv: withValueAliases(EN_CATALOG, JV_CATALOG),
  ar: withValueAliases(EN_CATALOG, AR_CATALOG),
  zh: withValueAliases(EN_CATALOG, ZH_CATALOG),
  ru: withValueAliases(EN_CATALOG, RU_CATALOG),
  en: EN_CATALOG,
};

/** Canonical (non-alias) translation keys of the built-in node catalog. */
export const BUILTIN_NODE_CATALOG_KEYS: readonly string[] = Object.freeze(Object.keys(EN_CATALOG).sort());

function isKnownAlias(alias: string): boolean {
  return (BUILTIN_NODE_ALIASES as readonly string[]).includes(alias);
}

export interface NodeCatalogEntry {
  alias: string;
  label: string;
  description: string;
  locale: SupportedLocale;
}

/** Read a catalog entry for a known built-in node alias (null otherwise). */
export function getNodeCatalogEntry(alias: unknown, locale: LocaleInput = 'id'): NodeCatalogEntry | null {
  if (typeof alias !== 'string' || !isKnownAlias(alias)) return null;
  const target = NativeLocalizationService.normalizeLocale(locale);
  const table = BUILTIN_NODE_CATALOG[target];
  const enTable = BUILTIN_NODE_CATALOG.en;
  return {
    alias,
    label: table[`node.${alias}.label`] ?? enTable[`node.${alias}.label`],
    description: table[`node.${alias}.description`] ?? enTable[`node.${alias}.description`],
    locale: target,
  };
}

export interface TranslationRegistrar {
  registerTranslations(locale: LocaleInput, translations: Readonly<Record<string, string>>): void;
}

/**
 * Register the built-in catalog on any service exposing
 * `registerTranslations(locale, catalog)` — the UniversalLocaleEnforcer,
 * BackendLocalizationService, or the reconstructed WorkflowExecutionEngine.
 */
export function registerBuiltInNodeCatalog(service: TranslationRegistrar): TranslationRegistrar {
  if (!service || typeof service.registerTranslations !== 'function') {
    throw new TypeError('registerBuiltInNodeCatalog: service must expose registerTranslations(locale, catalog)');
  }
  for (const locale of SUPPORTED_LOCALE_CODES) {
    service.registerTranslations(locale, BUILTIN_NODE_CATALOG[locale]);
  }
  return service;
}

export interface NodeMetadataLike {
  [key: string]: unknown;
}

export interface TextTranslator {
  translate(key: string, locale?: LocaleInput, parameters?: TranslationParameters): string;
  translateText(text: string, locale?: LocaleInput): string;
}

/**
 * Pure node-metadata localizer. Returns a copy of the node definition with
 * `label`/`description` filled from (or translated via) the catalog. Machine
 * fields (`name`, `type`, `parameters`, `id`, `position`, ...) are never
 * touched and the caller's object is never mutated.
 */
export function localizeNodeMetadata(
  node: NodeMetadataLike,
  locale: LocaleInput = 'id',
  service?: TextTranslator | null,
): NodeMetadataLike {
  if (node === null || typeof node !== 'object') return node;
  const target = NativeLocalizationService.normalizeLocale(locale);
  const alias = nodeAliasOf(node.type);
  const out: NodeMetadataLike = { ...node };

  const translate = (text: unknown): unknown => {
    if (typeof text !== 'string' || text.length === 0) return text;
    if (service && typeof service.translateText === 'function') return service.translateText(text, target);
    const table = BUILTIN_NODE_CATALOG[target];
    return Object.prototype.hasOwnProperty.call(table, text) ? table[text] : text;
  };

  const catalogValue = (key: string): string => {
    if (service && typeof service.translate === 'function') return service.translate(key, target);
    return BUILTIN_NODE_CATALOG[target][key] ?? BUILTIN_NODE_CATALOG.en[key];
  };

  if (alias && isKnownAlias(alias) && getNodeCatalogEntry(alias)) {
    if (out.label !== undefined) out.label = translate(out.label);
    else out.label = catalogValue(`node.${alias}.label`);
    if (out.description !== undefined) out.description = translate(out.description);
    else out.description = catalogValue(`node.${alias}.description`);
  }
  return out;
}

export interface CommunityNodeMeta {
  label?: string;
  description?: string;
  parameters?: Readonly<Record<string, string>>;
}

/**
 * Build a flat registration catalog for a community package's nodes.
 * `nodes` maps node alias -> { label, description, parameters? }.
 */
export function createCommunityNodeCatalog(
  locale: LocaleInput,
  packageName: string,
  nodes: Readonly<Record<string, CommunityNodeMeta | null | undefined>>,
): Readonly<Record<string, string>> {
  if (typeof packageName !== 'string' || packageName.trim() === '') {
    throw new TypeError('createCommunityNodeCatalog: packageName is required');
  }
  NativeLocalizationService.normalizeLocale(locale);
  const catalog: Record<string, string> = {};
  for (const [alias, meta] of Object.entries(nodes ?? {})) {
    if (meta === null || meta === undefined || typeof meta !== 'object') continue;
    if (typeof meta.label === 'string' && meta.label.length > 0) {
      catalog[`community.${packageName}.${alias}.label`] = meta.label;
    }
    if (typeof meta.description === 'string' && meta.description.length > 0) {
      catalog[`community.${packageName}.${alias}.description`] = meta.description;
    }
    for (const [param, display] of Object.entries(meta.parameters ?? {})) {
      if (typeof display === 'string' && display.length > 0) {
        catalog[`community.${packageName}.${alias}.parameters.${param}`] = display;
      }
    }
  }
  return catalog;
}

/**
 * Register a community node catalog through the same seam as built-ins.
 * Technical tokens are never part of the catalog; only human-facing text.
 */
export function registerCommunityNodeCatalog(
  service: TranslationRegistrar,
  locale: LocaleInput,
  packageName: string,
  nodes: Readonly<Record<string, CommunityNodeMeta | null | undefined>>,
): TranslationRegistrar {
  if (!service || typeof service.registerTranslations !== 'function') {
    throw new TypeError('registerCommunityNodeCatalog: service must expose registerTranslations(locale, catalog)');
  }
  service.registerTranslations(locale, createCommunityNodeCatalog(locale, packageName, nodes));
  return service;
}
