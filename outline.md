# 个人收藏夹整理应用 - 项目结构大纲

## 文件结构
```
OKComputer_Web_Manager
├── index.html              # 主页面 - 应用入口
├── main.js                 # Vue应用主文件
├── style.css               # 主页面样式
├── resources/              # 资源文件夹
│   ├── icons/             # 图标文件
│   ├── images/            # 图片资源
│   └── data/              # 示例数据文件
├── interaction.md          # 交互设计文档
├── design.md              # 设计风格文档
└── outline.md             # 项目结构文档
```

## 主要组件结构

### 1. index.html
- **页面结构**：完整的HTML5文档结构
- **头部引入**：Vue.js、Anime.js、Splitting.js、ECharts、Pixi.js等库
- **样式定义**：Tailwind CSS和自定义样式（自定义样式已分离）
- **应用挂载点**：#app容器

### 2. main.js - Vue应用核心
- **Vue实例初始化**：创建Vue 3应用实例
- **数据管理**：
  - bookmarks: 书签数据数组
  - categories: 分类树形结构
  - tags: 标签系统数据
  - searchQuery: 搜索关键词
  - selectedCategory: 当前选中的分类
  - viewMode: 视图模式（网格/列表）

- **组件定义**：
  - **BookmarkApp**: 根组件，包含整个应用布局
  - **Sidebar**: 左侧树形分类侧边栏
  - **BookmarkGrid**: 右侧书签卡片网格
  - **BookmarkCard**: 单个书签卡片组件
  - **SearchBar**: 搜索栏组件
  - **TagCloud**: 标签云组件
  - **ImportExport**: 导入导出功能组件

- **方法实现**：
  - 书签CRUD操作（增删改查）
  - 分类管理操作
  - 搜索和过滤逻辑
  - 拖拽排序功能
  - 本地存储数据管理
  - 导入导出功能

### 3. 功能模块详细设计

#### 数据模型
```javascript
// 书签数据结构
{
  id: 'unique-id',
  title: '网站标题',
  url: 'https://example.com',
  description: '网站描述',
  favicon: 'favicon-url',
  category: '分类ID',
  tags: ['标签1', '标签2'],
  createdAt: timestamp,
  updatedAt: timestamp,
  visitCount: 0
}

// 分类数据结构
{
  id: 'category-id',
  name: '分类名称',
  parentId: '父分类ID',
  order: 0,
  isExpanded: true
}
```

#### 核心功能实现
1. **本地存储管理**
   - 使用localStorage存储所有数据
   - 实现数据备份和恢复机制
   - 支持数据导入导出

2. **搜索算法**
   - 模糊搜索：支持标题、描述、URL匹配
   - 标签过滤：多标签组合过滤
   - 分类过滤：按分类层级过滤

3. **拖拽排序**
   - 使用HTML5 Drag and Drop API
   - 视觉反馈：拖拽时显示放置位置
   - 支持跨分类拖拽

4. **响应式设计**
   - 移动端：抽屉式侧边栏
   - 平板端：可折叠侧边栏
   - 桌面端：固定三栏布局

### 4. 视觉效果实现

#### 背景效果
- 使用Pixi.js创建微妙粒子背景
- 渐变叠加增强层次感
- 不干扰内容阅读

#### 动画效果
- 卡片悬停：3D倾斜效果
- 页面切换：淡入淡出过渡
- 数据加载：骨架屏动画

#### 交互反馈
- 按钮点击：轻微缩放效果
- 表单验证：实时错误提示
- 成功操作：绿色勾选动画

## 开发优先级

### 第一阶段（核心功能）
1. 基础HTML结构和Vue应用搭建
2. 数据模型和本地存储实现
3. 左侧树形分类组件
4. 右侧书签卡片展示
5. 基本的增删改查功能

### 第二阶段（增强功能）
1. 搜索和过滤系统
2. 标签系统和管理
3. 拖拽排序功能
4. 导入导出功能

### 第三阶段（优化完善）
1. 响应式设计适配
2. 动画效果和视觉优化
3. 性能优化和错误处理
4. 用户体验改进

### 第四阶段（部署发布）
1. 功能测试和调试
2. 代码压缩和优化
3. 部署到公网
4. 打包源码交付