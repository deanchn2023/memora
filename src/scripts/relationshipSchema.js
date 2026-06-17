/**
 * Memora v2.5 — 人脉图谱 Schema 定义与数据初始化
 * 7 类实体（Node Labels）+ 12 类关系（Edge Types）
 * 以 Architect 为核心的产品架构师团队图谱
 */

const RelationshipSchema = {
  // ===== 实体类型定义 =====
  nodeTypes: {
    Architect: {
      label: '架构师',
      color: '#007AFF',
      icon: '👤',
      properties: ['name', 'city', 'role', 'isPrimary', 'joinDate', 'accountId'],
      required: ['name'],
      displayField: 'name',
      size: 36  // 图谱中节点基础大小
    },
    Region: {
      label: '区域',
      color: '#FF9500',
      icon: '📍',
      properties: ['name', 'code'],
      required: ['name'],
      displayField: 'name',
      size: 30
    },
    Industry: {
      label: '行业',
      color: '#34C759',
      icon: '🏭',
      properties: ['name', 'priority'],
      required: ['name'],
      displayField: 'name',
      size: 28
    },
    Customer: {
      label: '客户',
      color: '#AF52DE',
      icon: '🏢',
      properties: ['name', 'tier', 'sector'],
      required: ['name'],
      displayField: 'name',
      size: 24
    },
    Case: {
      label: '案例',
      color: '#5AC8FA',
      icon: '📋',
      properties: ['name', 'status', 'amount', 'phase', 'deployMode'],
      required: ['name'],
      displayField: 'name',
      size: 20
    },
    Product: {
      label: '产品',
      color: '#FF2D55',
      icon: '📦',
      properties: ['name', 'version'],
      required: ['name'],
      displayField: 'name',
      size: 26
    },
    City: {
      label: '城市',
      color: '#5856D6',
      icon: '🏙',
      properties: ['name'],
      required: ['name'],
      displayField: 'name',
      size: 22
    }
  },

  // ===== 关系类型定义 =====
  edgeTypes: {
    // Architect → Region
    BELONGS_TO: {
      label: '隶属',
      source: 'Architect',
      target: 'Region',
      color: '#FF9500',
      dashed: false,
      properties: ['isPrimary'],
      description: '架构师隶属区域（isPrimary 区分专职/兼任）'
    },
    // Architect → Industry
    COVERS: {
      label: '覆盖',
      source: 'Architect',
      target: 'Industry',
      color: '#34C759',
      dashed: false,
      properties: [],
      description: '架构师覆盖行业'
    },
    // Architect → Customer
    SUPPORTS: {
      label: '支撑',
      source: 'Architect',
      target: 'Customer',
      color: '#AF52DE',
      dashed: false,
      properties: ['since'],
      description: '架构师支撑客户'
    },
    // Architect → Case
    LEADS: {
      label: '主导',
      source: 'Architect',
      target: 'Case',
      color: '#5AC8FA',
      dashed: false,
      properties: [],
      description: '架构师主导案例'
    },
    // Architect → City
    LOCATED_IN: {
      label: '所在',
      source: 'Architect',
      target: 'City',
      color: '#5856D6',
      dashed: false,
      properties: [],
      description: '架构师所在城市'
    },
    // Architect → Architect（跨区兼任）
    CROSS_REGION: {
      label: '跨区兼任',
      source: 'Architect',
      target: 'Architect',
      color: '#FF9500',
      dashed: true,
      properties: [],
      description: '架构师跨区兼任关系'
    },
    // Architect → Architect（协作）
    COOPERATES: {
      label: '协作',
      source: 'Architect',
      target: 'Architect',
      color: '#007AFF',
      dashed: true,
      properties: ['event'],
      description: '架构师协作关系'
    },
    // Case → Customer
    FOR: {
      label: '归属',
      source: 'Case',
      target: 'Customer',
      color: '#AF52DE',
      dashed: false,
      properties: [],
      description: '案例归属客户'
    },
    // Case → Industry
    IN: {
      label: '所属行业',
      source: 'Case',
      target: 'Industry',
      color: '#34C759',
      dashed: false,
      properties: [],
      description: '案例所属行业'
    },
    // Case → Product
    USES: {
      label: '使用',
      source: 'Case',
      target: 'Product',
      color: '#FF2D55',
      dashed: false,
      properties: [],
      description: '案例使用的产品'
    },
    // Customer → Industry
    CUSTOMER_IN: {
      label: '所属行业',
      source: 'Customer',
      target: 'Industry',
      color: '#34C759',
      dashed: true,
      properties: [],
      description: '客户所属行业'
    },
    // Region → City
    CONTAINS: {
      label: '包含',
      source: 'Region',
      target: 'City',
      color: '#5856D6',
      dashed: true,
      properties: [],
      description: '区域包含城市'
    }
  },

  // ===== 颜色映射 =====
  tierColors: {
    '标杆': '#FF2D55',
    '重点': '#FF9500',
    '一般': '#007AFF',
    '其他': '#8E8E93'
  },

  statusColors: {
    '已签约': '#34C759',
    'POC中': '#007AFF',
    '投标中': '#FF9500',
    '有机会': '#5AC8FA',
    '已拜访': '#8E8E93',
    '无机会': '#AEAEB2',
    '未拜访': '#C7C7CC',
    '未知': '#C7C7CC'
  }
};

/**
 * 初始数据集 — 产品架构师团队全景
 * 包含：16位架构师 + 3区域 + 12行业 + 客户数据 + 产品
 */
const INITIAL_DATA = {
  // ===== 区域 =====
  regions: [
    { id: 'region-north', name: '北区', code: 'N' },
    { id: 'region-east', name: '东区', code: 'E' },
    { id: 'region-south', name: '南区', code: 'S' }
  ],

  // ===== 城市 =====
  cities: [
    { id: 'city-bj', name: '北京' },
    { id: 'city-sh', name: '上海' },
    { id: 'city-sz', name: '深圳' },
    { id: 'city-gz', name: '广州' }
  ],

  // ===== 行业 =====
  industries: [
    { id: 'ind-paninternet', name: '泛互/战略', priority: 'high' },
    { id: 'ind-education', name: '教育', priority: 'high' },
    { id: 'ind-retail', name: '零售消费', priority: 'high' },
    { id: 'ind-finance', name: '金融', priority: 'high' },
    { id: 'ind-energy', name: '能源/制造/消费电子', priority: 'high' },
    { id: 'ind-medical', name: '医疗', priority: 'high' },
    { id: 'ind-carrier', name: '运营商', priority: 'medium' },
    { id: 'ind-gov', name: '政务政法', priority: 'medium' },
    { id: 'ind-travel', name: '文旅地产', priority: 'medium' },
    { id: 'ind-digifin', name: '数金交传', priority: 'medium' },
    { id: 'ind-transport', name: '出行', priority: 'medium' },
    { id: 'ind-overseas', name: '海外', priority: 'low' }
  ],

  // ===== 产品 =====
  products: [
    { id: 'prod-adp', name: 'ADP', version: 'V2' },
    { id: 'prod-codebuddy', name: 'CodeBuddy', version: '' },
    { id: 'prod-workbuddy', name: 'WorkBuddy', version: '' },
    { id: 'prod-portal', name: 'Agent Portal', version: '' },
    { id: 'prod-claw', name: 'Claw Pro', version: '' },
    { id: 'prod-bailian', name: '百炼', version: '' },
    { id: 'prod-coze', name: 'Coze', version: '' },
    { id: 'prod-dify', name: 'Dify', version: '' },
    { id: 'prod-fastgpt', name: 'FastGPT', version: '' },
    { id: 'prod-hiagent', name: 'HiAgent', version: '' }
  ],

  // ===== 架构师（16人 + 5公线 + 3实习生） =====
  architects: [
    // 北区 5人
    { id: 'arch-ww', name: '王巍', city: 'city-bj', role: '产品架构师', accountId: 'viviweiwang', isPrimary: true },
    { id: 'arch-lzy', name: '林致远', city: 'city-bj', role: '产品架构师', accountId: 'liamzylin', isPrimary: true },
    { id: 'arch-fzk', name: '付志昆', city: 'city-bj', role: '产品架构师', accountId: 'mambafu', isPrimary: true },
    { id: 'arch-wy', name: '王越', city: 'city-bj', role: '产品架构师', accountId: 'altaswang', isPrimary: true },
    { id: 'arch-sym', name: '宋勇明', city: 'city-bj', role: '产品架构师', accountId: 'symbosong', isPrimary: true },
    // 东区 8人
    { id: 'arch-ml', name: '马磊', city: 'city-sh', role: '产品架构师', accountId: 'maricogma', isPrimary: true },
    { id: 'arch-xcc', name: '程雪璨', city: 'city-sh', role: '产品架构师', accountId: 'xuecancheng', isPrimary: true },
    { id: 'arch-lt', name: '刘涛', city: 'city-sh', role: '产品架构师', accountId: 'steffanliu', isPrimary: true },
    { id: 'arch-ldc', name: '李德超', city: 'city-sh', role: '产品架构师', accountId: 'readli', isPrimary: true },
    { id: 'arch-qy', name: '邱毅', city: 'city-sh', role: '产品架构师', accountId: 'easonqiu', isPrimary: true },
    { id: 'arch-zdw', name: '赵登梧', city: 'city-sh', role: '产品架构师', accountId: 'neildwzhao', isPrimary: true },
    { id: 'arch-yd', name: '晏栋', city: 'city-sh', role: '产品架构师', accountId: 'vincentdyan', isPrimary: true },
    { id: 'arch-hz', name: '胡哲', city: 'city-sh', role: '产品架构师', accountId: 'sherwinhu', isPrimary: true },
    // 南区 3人（专职）
    { id: 'arch-htt', name: '洪彤彤', city: 'city-sz', role: '产品架构师', accountId: '', isPrimary: true },
    { id: 'arch-qlm', name: '秦立明', city: 'city-sz', role: '产品架构师', accountId: 'limingqin', isPrimary: true },
    { id: 'arch-kcr', name: '况成润', city: 'city-sz', role: '产品架构师', accountId: 'logankuang', isPrimary: true },
    // 公线支持团队
    { id: 'arch-zck', name: '朱从坤', city: 'city-sh', role: '公线支持总协调', accountId: 'congkunzhu', isPrimary: true },
    { id: 'arch-tl', name: '汤磊', city: 'city-sh', role: '东区区域ADP', accountId: 'v_aleitang', isPrimary: true },
    { id: 'arch-jcy', name: '姜传永', city: 'city-sz', role: '南区金融/出行支持', accountId: 'v_acyjjiang', isPrimary: true },
    { id: 'arch-lzh', name: '李振华', city: 'city-sz', role: '南区区域ADP', accountId: 'v_azhenhli', isPrimary: true },
    { id: 'arch-zwy', name: '张文溢', city: '', role: '其他支持', accountId: '', isPrimary: true },
    { id: 'arch-lyc', name: '刘伊超', city: '', role: '其他支持', accountId: 'v_aycliu', isPrimary: true },
    // 实习同学
    { id: 'arch-cmy', name: '蔡沐雨', city: '', role: '实习生', accountId: 'camillecai', isPrimary: true },
    { id: 'arch-zjq', name: '周家齐', city: '', role: '实习生', accountId: 'carmelazhou', isPrimary: true },
    { id: 'arch-lxt', name: '刘宣彤', city: '', role: '实习生', accountId: '', isPrimary: true }
  ],

  // ===== 架构师-区域关系 =====
  architectRegions: [
    // 北区
    { architect: 'arch-ww', region: 'region-north', isPrimary: true },
    { architect: 'arch-lzy', region: 'region-north', isPrimary: true },
    { architect: 'arch-fzk', region: 'region-north', isPrimary: true },
    { architect: 'arch-wy', region: 'region-north', isPrimary: true },
    { architect: 'arch-sym', region: 'region-north', isPrimary: true },
    // 东区
    { architect: 'arch-ml', region: 'region-east', isPrimary: true },
    { architect: 'arch-xcc', region: 'region-east', isPrimary: true },
    { architect: 'arch-lt', region: 'region-east', isPrimary: true },
    { architect: 'arch-ldc', region: 'region-east', isPrimary: true },
    { architect: 'arch-qy', region: 'region-east', isPrimary: true },
    { architect: 'arch-zdw', region: 'region-east', isPrimary: true },
    { architect: 'arch-yd', region: 'region-east', isPrimary: true },
    { architect: 'arch-hz', region: 'region-east', isPrimary: true },
    // 南区
    { architect: 'arch-htt', region: 'region-south', isPrimary: true },
    { architect: 'arch-qlm', region: 'region-south', isPrimary: true },
    { architect: 'arch-kcr', region: 'region-south', isPrimary: true },
    // 跨区兼任（南区+东区）
    { architect: 'arch-lt', region: 'region-south', isPrimary: false },
    { architect: 'arch-ldc', region: 'region-south', isPrimary: false },
    { architect: 'arch-zdw', region: 'region-south', isPrimary: false },
  ],

  // ===== 架构师-行业覆盖 =====
  architectIndustries: [
    // 泛互/战略
    { architect: 'arch-ww', industry: 'ind-paninternet' },
    { architect: 'arch-ml', industry: 'ind-paninternet' },
    { architect: 'arch-hz', industry: 'ind-paninternet' },
    // 教育
    { architect: 'arch-ww', industry: 'ind-education' },
    { architect: 'arch-xcc', industry: 'ind-education' },
    { architect: 'arch-htt', industry: 'ind-education' },
    // 零售消费
    { architect: 'arch-ww', industry: 'ind-retail' },
    { architect: 'arch-xcc', industry: 'ind-retail' },
    { architect: 'arch-kcr', industry: 'ind-retail' },
    { architect: 'arch-zdw', industry: 'ind-retail' },
    // 金融
    { architect: 'arch-wy', industry: 'ind-finance' },
    { architect: 'arch-sym', industry: 'ind-finance' },
    { architect: 'arch-zdw', industry: 'ind-finance' },
    { architect: 'arch-kcr', industry: 'ind-finance' },
    // 能源/制造/消费电子
    { architect: 'arch-lzy', industry: 'ind-energy' },
    { architect: 'arch-fzk', industry: 'ind-energy' },
    { architect: 'arch-qy', industry: 'ind-energy' },
    { architect: 'arch-qlm', industry: 'ind-energy' },
    // 医疗
    { architect: 'arch-fzk', industry: 'ind-medical' },
    { architect: 'arch-qy', industry: 'ind-medical' },
    { architect: 'arch-zdw', industry: 'ind-medical' },
    // 运营商
    { architect: 'arch-lzy', industry: 'ind-carrier' },
    { architect: 'arch-lt', industry: 'ind-carrier' },
    { architect: 'arch-zdw', industry: 'ind-carrier' },
    // 政务政法
    { architect: 'arch-lt', industry: 'ind-gov' },
    // 文旅地产
    { architect: 'arch-ldc', industry: 'ind-travel' },
    // 数金交传
    { architect: 'arch-lzy', industry: 'ind-digifin' },
    { architect: 'arch-yd', industry: 'ind-digifin' },
    { architect: 'arch-qlm', industry: 'ind-digifin' },
    // 出行
    { architect: 'arch-qy', industry: 'ind-transport' },
    { architect: 'arch-kcr', industry: 'ind-transport' },
    // 海外
    { architect: 'arch-hz', industry: 'ind-overseas' },
  ],

  // ===== 区域-城市 =====
  regionCities: [
    { region: 'region-north', city: 'city-bj' },
    { region: 'region-east', city: 'city-sh' },
    { region: 'region-south', city: 'city-sz' },
    { region: 'region-south', city: 'city-gz' }
  ],

  // ===== 跨区兼任关系（Architect → Architect） =====
  crossRegions: [
    { source: 'arch-lt', target: 'arch-lt', note: '东+南跨区' },
    { source: 'arch-ldc', target: 'arch-ldc', note: '东+南跨区' },
    { source: 'arch-zdw', target: 'arch-zdw', note: '东+南跨区' },
  ],

  // ===== 协作关系（公线团队） =====
  cooperations: [
    { source: 'arch-zck', target: 'arch-tl', event: '东区区域ADP支持' },
    { source: 'arch-zck', target: 'arch-jcy', event: '南区金融/出行支持' },
    { source: 'arch-zck', target: 'arch-lzh', event: '南区区域ADP支持' },
    { source: 'arch-zck', target: 'arch-zwy', event: '其他支持' },
    { source: 'arch-zck', target: 'arch-lyc', event: '其他支持' },
  ]
};

// 导出
window.RelationshipSchema = RelationshipSchema;
window.INITIAL_DATA = INITIAL_DATA;
console.log('[RelationshipSchema] Schema & initial data loaded');
