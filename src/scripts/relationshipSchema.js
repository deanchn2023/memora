/**
 * Memora v2.5 — 人脉图谱 Schema 定义与数据初始化
 * 10 类实体（Node Labels）+ 15 类关系（Edge Types）
 * 以 Architect 为核心的产品架构师团队图谱
 * 支持插旗表全部 30 列数据字段
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
      size: 36
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
      properties: ['name', 'level', 'priority', 'parentIndustry'],
      required: ['name'],
      displayField: 'name',
      size: 28
    },
    Customer: {
      label: '客户',
      color: '#AF52DE',
      icon: '🏢',
      properties: [
        'name', 'tier', 'industryL1', 'industryL2',
        'channel', 'aiDemand', 'productForm',
        'biddingWinner', 'biddingDate', 'tencentParticipated',
        'cloudProductConnected', 'convertedToOpportunity', 'followupStatus',
        'signingStatus', 'competitorProducts', 'product',
        'cemLink', 'notes', 'authorityTag',
        'supplementaryNote', 'track', 'tag',
        'region', 'relatedMaterials', 'targetCustomer'
      ],
      required: ['name'],
      displayField: 'name',
      size: 24
    },
    Sales: {
      label: '行业销售',
      color: '#FF6B35',
      icon: '💼',
      properties: ['name', 'region'],
      required: ['name'],
      displayField: 'name',
      size: 22
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
    Partner: {
      label: '伙伴',
      color: '#00C7BE',
      icon: '🤝',
      properties: ['name', 'status', 'channelManager'],
      required: ['name'],
      displayField: 'name',
      size: 22
    },
    Channel: {
      label: '通路',
      color: '#BF5AF2',
      icon: '🔀',
      properties: ['name'],
      required: ['name'],
      displayField: 'name',
      size: 18
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
      description: '架构师隶属区域'
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
    // Customer → Sales
    SOLD_BY: {
      label: '销售跟进',
      source: 'Customer',
      target: 'Sales',
      color: '#FF6B35',
      dashed: false,
      properties: [],
      description: '行业销售跟进客户'
    },
    // Customer → Channel
    VIA_CHANNEL: {
      label: '通路',
      source: 'Customer',
      target: 'Channel',
      color: '#BF5AF2',
      dashed: true,
      properties: [],
      description: '客户通过通路接入'
    },
    // Customer → Partner
    PARTNER_WITH: {
      label: '伙伴合作',
      source: 'Customer',
      target: 'Partner',
      color: '#00C7BE',
      dashed: true,
      properties: ['status'],
      description: '客户有伙伴合作'
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
    '业内 TOP 20（头部标杆）': '#FF2D55',
    '业内 TOP 50': '#FF9500',
    '业内 TOP 100': '#007AFF',
    '其他': '#8E8E93'
  },

  statusColors: {
    '已中标/签约': '#34C759',
    '已验收': '#34C759',
    'poc中': '#007AFF',
    '投标阶段': '#FF9500',
    '有机会的商机': '#5AC8FA',
    '已拜访，暂无机会': '#8E8E93',
    '未拜访，当前无商机': '#AEAEB2',
    '各类原因无机会，也无拜访计划': '#C7C7CC',
    '未知': '#C7C7CC'
  },

  // ===== Excel 列名 → Customer 属性映射 =====
  columnMapping: {
    '客户名': 'name',
    '一级行业': 'industryL1',
    '二级行业': 'industryL2',
    '通路': 'channel',
    '产品架构师': 'architect',
    '客户对智能体需求': 'aiDemand',
    '产品形态': 'productForm',
    '中标方': 'biddingWinner',
    '中标时间': 'biddingDate',
    '腾讯是否参与poc/投标': 'tencentParticipated',
    '行业销售': 'sales',
    '客户分层': 'tier',
    '云产三是否已建联': 'cloudProductConnected',
    '是否转为商机': 'convertedToOpportunity',
    '跟进状态': 'followupStatus',
    '参与友商': 'competitorProducts',
    '产品': 'product',
    'CEM链接': 'cemLink',
    '备注': 'notes',
    '权威标签': 'authorityTag',
    '重点补充说明': 'supplementaryNote',
    '伙伴名称': 'partnerName',
    '伙伴合作状态': 'partnerStatus',
    '渠道经理': 'channelManager',
    '赛道': 'track',
    '标签': 'tag',
    '区域': 'region',
    '相关资料': 'relatedMaterials',
    '目标客户': 'targetCustomer',
    '签约状态': 'signingStatus'
  }
};

/**
 * 初始数据集 — 产品架构师团队全景
 */
const INITIAL_DATA = {
  // ===== 区域 =====
  regions: [
    { id: 'region-north', name: '华北', code: 'N' },
    { id: 'region-east', name: '华东', code: 'E' },
    { id: 'region-south', name: '华南', code: 'S' }
  ],

  // ===== 城市 =====
  cities: [
    { id: 'city-bj', name: '北京' },
    { id: 'city-sh', name: '上海' },
    { id: 'city-sz', name: '深圳' },
    { id: 'city-gz', name: '广州' }
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
    { id: 'prod-hiagent', name: 'HiAgent', version: '' },
    { id: 'prod-ti', name: 'Ti', version: '' },
    { id: 'prod-dlr', name: '数智人', version: '' },
    { id: 'prod-cs-ai', name: '大模型客服', version: '' }
  ],

  // ===== 通路 =====
  channels: [
    { id: 'ch-ka', name: 'KA' },
    { id: 'ch-region', name: '区域' },
    { id: 'ch-channel', name: '渠道' },
    { id: 'ch-region-sales', name: '区域销售' },
    { id: 'ch-channel-sales', name: '渠道销售' }
  ],

  // ===== 架构师 =====
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
    { architect: 'arch-ww', region: 'region-north', isPrimary: true },
    { architect: 'arch-lzy', region: 'region-north', isPrimary: true },
    { architect: 'arch-fzk', region: 'region-north', isPrimary: true },
    { architect: 'arch-wy', region: 'region-north', isPrimary: true },
    { architect: 'arch-sym', region: 'region-north', isPrimary: true },
    { architect: 'arch-ml', region: 'region-east', isPrimary: true },
    { architect: 'arch-xcc', region: 'region-east', isPrimary: true },
    { architect: 'arch-lt', region: 'region-east', isPrimary: true },
    { architect: 'arch-ldc', region: 'region-east', isPrimary: true },
    { architect: 'arch-qy', region: 'region-east', isPrimary: true },
    { architect: 'arch-zdw', region: 'region-east', isPrimary: true },
    { architect: 'arch-yd', region: 'region-east', isPrimary: true },
    { architect: 'arch-hz', region: 'region-east', isPrimary: true },
    { architect: 'arch-htt', region: 'region-south', isPrimary: true },
    { architect: 'arch-qlm', region: 'region-south', isPrimary: true },
    { architect: 'arch-kcr', region: 'region-south', isPrimary: true },
    { architect: 'arch-lt', region: 'region-south', isPrimary: false },
    { architect: 'arch-ldc', region: 'region-south', isPrimary: false },
    { architect: 'arch-zdw', region: 'region-south', isPrimary: false },
  ],

  // ===== 架构师-行业覆盖 =====
  architectIndustries: [
    { architect: 'arch-ww', industry: 'ind-paninternet' },
    { architect: 'arch-ml', industry: 'ind-paninternet' },
    { architect: 'arch-hz', industry: 'ind-paninternet' },
    { architect: 'arch-ww', industry: 'ind-education' },
    { architect: 'arch-xcc', industry: 'ind-education' },
    { architect: 'arch-htt', industry: 'ind-education' },
    { architect: 'arch-ww', industry: 'ind-retail' },
    { architect: 'arch-xcc', industry: 'ind-retail' },
    { architect: 'arch-kcr', industry: 'ind-retail' },
    { architect: 'arch-zdw', industry: 'ind-retail' },
    { architect: 'arch-wy', industry: 'ind-finance' },
    { architect: 'arch-sym', industry: 'ind-finance' },
    { architect: 'arch-zdw', industry: 'ind-finance' },
    { architect: 'arch-kcr', industry: 'ind-finance' },
    { architect: 'arch-lzy', industry: 'ind-energy' },
    { architect: 'arch-fzk', industry: 'ind-energy' },
    { architect: 'arch-qy', industry: 'ind-energy' },
    { architect: 'arch-qlm', industry: 'ind-energy' },
    { architect: 'arch-fzk', industry: 'ind-medical' },
    { architect: 'arch-qy', industry: 'ind-medical' },
    { architect: 'arch-zdw', industry: 'ind-medical' },
    { architect: 'arch-lzy', industry: 'ind-carrier' },
    { architect: 'arch-lt', industry: 'ind-carrier' },
    { architect: 'arch-zdw', industry: 'ind-carrier' },
    { architect: 'arch-lt', industry: 'ind-gov' },
    { architect: 'arch-ldc', industry: 'ind-travel' },
    { architect: 'arch-lzy', industry: 'ind-digifin' },
    { architect: 'arch-yd', industry: 'ind-digifin' },
    { architect: 'arch-qlm', industry: 'ind-digifin' },
    { architect: 'arch-qy', industry: 'ind-transport' },
    { architect: 'arch-kcr', industry: 'ind-transport' },
    { architect: 'arch-hz', industry: 'ind-overseas' },
  ],

  // ===== 区域-城市 =====
  regionCities: [
    { region: 'region-north', city: 'city-bj' },
    { region: 'region-east', city: 'city-sh' },
    { region: 'region-south', city: 'city-sz' },
    { region: 'region-south', city: 'city-gz' }
  ],

  // ===== 跨区兼任关系 =====
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
console.log('[RelationshipSchema] Schema & initial data loaded (v2 - full columns)');
