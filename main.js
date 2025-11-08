// Vue 3 应用主文件
console.log('[main.js] loaded');
const { createApp, ref, computed, onMounted, watch, nextTick } = Vue;

// 应用配置
const APP_CONFIG = {
    version: '1.0.0',
    storageKey: 'bookmark-manager-data',
    itemsPerPage: 24  // 修改这里：从12改为24
};

// 创建Vue应用
const app = createApp({
    setup() {
        // 响应式数据
        const bookmarks = ref([]);  // 存储所有书签数据
        const categories = ref([]);  // 存储所有分类数据
        const searchQuery = ref('');  // 搜索关键词
        const selectedCategory = ref('');  // 当前选中的分类ID
        const viewMode = ref('grid');  // 显示模式：'grid'网格或'list'列表
        const sortBy = ref('createdAt');  // 排序方式：时间、标题、访问次数
        const currentPage = ref(1);  // 当前页码（分页显示）
        const sidebarOpen = ref(true);  // 侧边栏是否展开
        const showAddBookmark = ref(false);  // 是否显示添加书签弹窗
        const showImportExport = ref(false);  // 是否显示导入导出弹窗
        const editingBookmark = ref(null);  // 当前正在编辑的书签
        const bookmarkForm = ref({  //书签表单数据对象
            title: '',
            url: '',
            description: '',
            category: '',
            tags: ''
        });
        const draggedBookmark = ref(null);  //记录当前被拖拽的书签对象
    const draggedCategoryId = ref(null); // 被拖拽的分类 id（用于分类重排）
    const hoveredCategoryId = ref(null); // 当前悬停高亮的分类 id
    const hoveredDropMode = ref(null); // 'before' | 'child' | 'after'
    // 撤销栈与提示
    const undoStack = ref([]);
    const undoToast = ref(false);
    const undoMessage = ref('');
    let undoTimer = null;
        // 批量选择相关
        const selectedIds = ref([]); // 存放被选中书签的 id 列表
        const bulkMoveTarget = ref(''); // 批量移动目标分类 id
    const bulkMode = ref(false); // 是否处于批量选择模式

        // 计算属性：获取所选分类的统计信息
        const selectedCategoryName = computed(() => {
            if (!selectedCategory.value) return '';
            const cat = categories.value.find(c => c.id === selectedCategory.value);
            return cat ? cat.name : '';
        });

        // 直接书签数（仅当前分类，不包含子分类）
        const directBookmarkCount = computed(() => {
            if (!selectedCategory.value) return 0;
            return bookmarks.value.filter(b => b.category === selectedCategory.value).length;
        });

        // 总书签数（包含子分类）
        const totalBookmarkCount = computed(() => {
            if (!selectedCategory.value) return 0;
            // 收集所有子分类ID
            const collectChildIds = (parentId) => {
                const ids = [parentId];
                categories.value.forEach(cat => {
                    if (cat.parentId === parentId) {
                        ids.push(...collectChildIds(cat.id));
                    }
                });
                return ids;
            };
            const allIds = collectChildIds(selectedCategory.value);
            return bookmarks.value.filter(b => allIds.includes(b.category)).length;
        });

        // 计算属性：构建分类树形结构
        const categoryTree = computed(() => {
            // 递归构建节点，确保每个节点都包含 children 与 count
            const buildNode = (cat) => {
                const children = categories.value
                    .filter(child => child.parentId === cat.id)
                    .map(child => buildNode(child));
                return {
                    ...cat,
                    children,
                    count: getCategoryCount(cat.id),
                    expanded: cat.expanded !== false
                };
            };

            const rootCategories = categories.value.filter(cat => !cat.parentId);
            return rootCategories.map(cat => buildNode(cat));
        });

        // 计算属性：将树形分类结构扁平化为带缩进前缀的列表
        const flatCategories = computed(() => {
            // 存储最终结果的数组
            const result = [];
            
            // 递归函数：遍历分类树并添加缩进前缀
            const addCategories = (cats, prefix = '') => {
                // 遍历当前层级的分类
                cats.forEach(cat => {
                    // 将分类添加到结果数组，名称前添加缩进前缀表示层级
                    result.push({ ...cat, name: prefix + cat.name });
                    
                    // 如果当前分类有子分类，递归处理子分类
                    if (cat.children) {
                        // 递归调用，为子分类添加更多缩进（增加两个空格）
                        addCategories(cat.children, prefix + '  ');
                    }
                });
            };
            
            // 从分类树的根节点开始递归处理
            addCategories(categoryTree.value);
            
            // 返回扁平化后的分类列表
            return result;
        });

        const popularTags = computed(() => {
            const tagCount = {};
            bookmarks.value.forEach(bookmark => {
                bookmark.tags.forEach(tag => {
                    tagCount[tag] = (tagCount[tag] || 0) + 1;
                });
            });
            
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'];
            return Object.entries(tagCount)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 10)
                .map(([name, count], index) => ({
                    name,
                    count,
                    color: colors[index % colors.length]
                }));
        });

        const filteredBookmarks = computed(() => {
            let filtered = bookmarks.value;

            // 按分类过滤
            if (selectedCategory.value) {
                const categoryIds = [selectedCategory.value];
                const addChildrenIds = (parentId) => {
                    categories.value
                        .filter(cat => cat.parentId === parentId)
                        .forEach(cat => {
                            categoryIds.push(cat.id);
                            addChildrenIds(cat.id);
                        });
                };
                addChildrenIds(selectedCategory.value);
                filtered = filtered.filter(bookmark => categoryIds.includes(bookmark.category));
            }

            // 按搜索关键词过滤
            if (searchQuery.value) {
                const query = searchQuery.value.toLowerCase();
                filtered = filtered.filter(bookmark => 
                    bookmark.title.toLowerCase().includes(query) ||
                    bookmark.description.toLowerCase().includes(query) ||
                    bookmark.url.toLowerCase().includes(query) ||
                    bookmark.tags.some(tag => tag.toLowerCase().includes(query))
                );
            }

            return filtered;
        });

        const sortedBookmarks = computed(() => {
            return [...filteredBookmarks.value].sort((a, b) => {
                switch (sortBy.value) {
                    case 'title':
                        return a.title.localeCompare(b.title);
                    case 'visitCount':
                        return b.visitCount - a.visitCount;
                    case 'createdAt':
                    default:
                        return new Date(b.createdAt) - new Date(a.createdAt);
                }
            });
        });

        const totalPages = computed(() => {
            return Math.ceil(sortedBookmarks.value.length / APP_CONFIG.itemsPerPage);
        });

        const paginatedBookmarks = computed(() => {
            const start = (currentPage.value - 1) * APP_CONFIG.itemsPerPage;
            const end = start + APP_CONFIG.itemsPerPage;
            return sortedBookmarks.value.slice(start, end);
        });

        const selectedCount = computed(() => selectedIds.value.length);
        // 当前分页是否全部被选中
        const isAllSelectedOnPage = computed(() => {
            const pageIds = paginatedBookmarks.value.map(b => b.id);
            if (pageIds.length === 0) return false;
            return pageIds.every(id => selectedIds.value.includes(id));
        });

        // 方法定义
        // 后端 API 基础路径（本地开发服务器）
        const API_BASE = 'http://localhost:3000/api';

        const apiGet = async (path) => {
            const resp = await fetch(API_BASE + path);
            if (!resp.ok) throw new Error(`GET ${path} ${resp.status}`);
            return resp.json();
        };
        const apiPost = async (path, body) => {
            const resp = await fetch(API_BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!resp.ok) throw new Error(`POST ${path} ${resp.status}`);
            return resp.json();
        };
        const apiPut = async (path, body) => {
            const resp = await fetch(API_BASE + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!resp.ok) throw new Error(`PUT ${path} ${resp.status}`);
            return resp.json();
        };
        const apiDelete = async (path) => {
            const resp = await fetch(API_BASE + path, { method: 'DELETE' });
            if (!resp.ok) throw new Error(`DELETE ${path} ${resp.status}`);
            return resp.json();
        };

        // loadData: 优先从后端获取（bookmarks & categories），后端不可用则回退到 localStorage
        const loadData = async () => {
            try {
                // 尝试通过 CRUD 查询获取数据
                const [cats, bms] = await Promise.all([
                    apiGet('/categories'),
                    apiGet('/bookmarks')
                ]);
                categories.value = cats || [];
                bookmarks.value = bms || [];
                // 确保存在默认分类并把未分类书签归入默认分类
                ensureDefaultCategory();
                bookmarks.value.forEach(b => { if (!b.category) b.category = DEFAULT_CATEGORY_ID; });
                return;
            } catch (err) {
                console.warn('无法连接后端 API，回退到 localStorage：', err.message);
            }

            // 回退到 localStorage
            try {
                const data = localStorage.getItem(APP_CONFIG.storageKey);
                if (data) {
                    const parsed = JSON.parse(data);
                    bookmarks.value = parsed.bookmarks || [];
                    categories.value = parsed.categories || [];
                } else {
                    initializeSampleData();
                }
            } catch (error) {
                console.error('加载 localStorage 数据失败:', error);
                initializeSampleData();
            }
        };

        // saveData: 首选将整个快照发到后端 snapshot（方便最小改动迁移），若失败写回 localStorage
        const saveData = async () => {
            const data = {
                bookmarks: bookmarks.value,
                categories: categories.value,
                version: APP_CONFIG.version,
                lastUpdated: new Date().toISOString()
            };
            try {
                await apiPost('/snapshot', data);
            } catch (err) {
                // 回退到 localStorage
                try {
                    localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(data));
                } catch (e) {
                    console.error('保存 localStorage 失败：', e);
                }
            }
        };

        const initializeSampleData = () => {
            categories.value = [
                { id: 'uncategorized', name: '未分类', parentId: null, order: 0, expanded: true },
                { id: 'work', name: '工作', parentId: null, order: 1, expanded: true },
                { id: 'tools', name: '开发工具', parentId: 'work', order: 2, expanded: true },
                { id: 'docs', name: '技术文档', parentId: 'work', order: 3, expanded: true },
                { id: 'personal', name: '个人', parentId: null, order: 4, expanded: true },
                { id: 'entertainment', name: '娱乐', parentId: 'personal', order: 5, expanded: true },
                { id: 'learning', name: '学习', parentId: 'personal', order: 6, expanded: true },
                { id: 'shopping', name: '购物', parentId: null, order: 7, expanded: true }
            ];

            bookmarks.value = [
                {
                    id: generateId(),
                    title: 'Vue.js 官方文档',
                    url: 'https://cn.vuejs.org/',
                    description: 'Vue.js - 渐进式 JavaScript 框架',
                    favicon: 'https://cn.vuejs.org/logo.svg',
                    category: 'docs',
                    tags: ['vue', '前端', '框架'],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    visitCount: 15
                },
                {
                    id: generateId(),
                    title: 'Tailwind CSS',
                    url: 'https://tailwindcss.com/',
                    description: '一个功能优先的 CSS 框架',
                    favicon: 'https://tailwindcss.com/favicons/favicon.ico',
                    category: 'tools',
                    tags: ['css', '框架', '设计'],
                    createdAt: new Date(Date.now() - 86400000).toISOString(),
                    updatedAt: new Date(Date.now() - 86400000).toISOString(),
                    visitCount: 8
                },
                {
                    id: generateId(),
                    title: 'GitHub',
                    url: 'https://github.com/',
                    description: '全球最大的代码托管平台',
                    favicon: 'https://github.githubassets.com/favicons/favicon.svg',
                    category: 'tools',
                    tags: ['git', '代码', '协作'],
                    createdAt: new Date(Date.now() - 172800000).toISOString(),
                    updatedAt: new Date(Date.now() - 172800000).toISOString(),
                    visitCount: 25
},
                {
                    id: generateId(),
                    title: 'Bilibili',
                    url: 'https://www.bilibili.com/',
                    description: '国内知名的视频弹幕网站',
                    favicon: 'https://www.bilibili.com/favicon.ico',
                    category: 'entertainment',
                    tags: ['视频', '娱乐', '弹幕'],
                    createdAt: new Date(Date.now() - 259200000).toISOString(),
                    updatedAt: new Date(Date.now() - 259200000).toISOString(),
                    visitCount: 42
                },
                {
                    id: generateId(),
                    title: 'MDN Web Docs',
                    url: 'https://developer.mozilla.org/',
                    description: 'Mozilla 的开发者平台',
                    favicon: 'https://developer.mozilla.org/favicon-48x48.cbbd161b.png',
                    category: 'docs',
                    tags: ['文档', 'web', '开发'],
                    createdAt: new Date(Date.now() - 345600000).toISOString(),
                    updatedAt: new Date(Date.now() - 345600000).toISOString(),
                    visitCount: 12
                },
                {
                    id: generateId(),
                    title: '淘宝',
                    url: 'https://www.taobao.com/',
                    description: '亚洲最大购物网站',
                    favicon: 'https://www.taobao.com/favicon.ico',
                    category: 'shopping',
                    tags: ['购物', '电商'],
                    createdAt: new Date(Date.now() - 432000000).toISOString(),
                    updatedAt: new Date(Date.now() - 432000000).toISOString(),
                    visitCount: 30
                }
            ];

            // 将没有分类的书签设为默认分类
            bookmarks.value.forEach(b => { if (!b.category) b.category = 'uncategorized'; });
            ensureDefaultCategory();
            saveData();
        };

        const DEFAULT_CATEGORY_ID = 'uncategorized';

        const ensureDefaultCategory = () => {
            const exist = categories.value.find(c => c.id === DEFAULT_CATEGORY_ID);
            if (!exist) {
                const def = { id: DEFAULT_CATEGORY_ID, name: '未分类', parentId: null, order: categories.value.length, expanded: true };
                categories.value.unshift(def);
                // 尝试持久化到后端（异步，不阻塞）
                apiPost('/categories', def).catch(() => {});
            }
        };

        const generateId = () => {
            return Date.now().toString(36) + Math.random().toString(36).substr(2);
        };

        const getCategoryCount = (categoryId) => {
            let count = bookmarks.value.filter(bookmark => bookmark.category === categoryId).length;
            const children = categories.value.filter(cat => cat.parentId === categoryId);
            children.forEach(child => {
                count += getCategoryCount(child.id);
            });
            return count;
        };

        const toggleSidebar = () => {
            sidebarOpen.value = !sidebarOpen.value;
        };

        const selectCategory = (categoryId) => {
            selectedCategory.value = selectedCategory.value === categoryId ? '' : categoryId;
            currentPage.value = 1;
        };

        const toggleCategory = (categoryId) => {
            const category = categories.value.find(cat => cat.id === categoryId);
            if (category) {
                category.expanded = !category.expanded;
                saveData();
            }
        };

        // 切换批量模式
        const toggleBulkMode = () => {
            bulkMode.value = !bulkMode.value;
            // 退出批量模式时清除选择
            if (!bulkMode.value) {
                clearSelection();
            }
        };

        // 处理项点击：如果在批量模式下切换选中，否则打开书签
        const handleItemClick = (bookmark, event) => {
            if (bulkMode.value) {
                // 当在批量模式时，点击卡片也切换选择（更友好）
                if (!selectedIds.value.includes(bookmark.id)) {
                    selectedIds.value.push(bookmark.id);
                } else {
                    selectedIds.value = selectedIds.value.filter(id => id !== bookmark.id);
                }
            } else {
                openBookmark(bookmark.url);
            }
        };

        // 切换选中/取消选中单个书签
        const toggleSelect = (bookmark, event) => {
            const checked = event.target.checked;
            if (checked) {
                if (!selectedIds.value.includes(bookmark.id)) selectedIds.value.push(bookmark.id);
            } else {
                selectedIds.value = selectedIds.value.filter(id => id !== bookmark.id);
            }
        };

        // 切换本页全选/清除（当前分页）
        const selectAllOnPage = () => {
            const pageIds = paginatedBookmarks.value.map(b => b.id);
            if (pageIds.length === 0) return;

            if (isAllSelectedOnPage.value) {
                // 如果本页已经全部被选中，则清除本页的选择
                selectedIds.value = selectedIds.value.filter(id => !pageIds.includes(id));
            } else {
                // 否则将本页全部加入选择
                const set = new Set([...selectedIds.value, ...pageIds]);
                selectedIds.value = Array.from(set);
            }
        };

        const clearSelection = () => {
            selectedIds.value = [];
            bulkMoveTarget.value = '';
        };

        const deleteSelected = async () => {
            if (selectedIds.value.length === 0) return;
            if (!confirm(`确定要删除所选的 ${selectedIds.value.length} 个书签吗？此操作不可恢复！`)) return;
            const ids = [...selectedIds.value];
            // 乐观更新
            bookmarks.value = bookmarks.value.filter(b => !ids.includes(b.id));
            clearSelection();
            try {
                await Promise.all(ids.map(id => apiDelete(`/bookmarks/${encodeURIComponent(id)}`)));
            } catch (err) {
                console.error('批量删除失败，稍后同步：', err);
                saveData();
            }
        };

        const moveSelectedToCategory = async (categoryId) => {
            if (!categoryId) return;
            if (selectedIds.value.length === 0) return;
            const ids = [...selectedIds.value];
            const prev = bookmarks.value.filter(b => ids.includes(b.id)).map(b => ({ id: b.id, from: b.category }));
            // 乐观更新
            bookmarks.value.forEach(b => { if (ids.includes(b.id)) { b.category = categoryId; b.updatedAt = new Date().toISOString(); } });
            clearSelection();
            try {
                await Promise.all(ids.map(id => {
                    const b = bookmarks.value.find(x => x.id === id);
                    return apiPut(`/bookmarks/${encodeURIComponent(id)}`, b);
                }));
            } catch (err) {
                console.error('移动失败，尝试回退或保存快照：', err);
                // 回退到之前状态 by snapshot save
                saveData();
                undoStack.value.push({ type: 'move', items: prev });
            }
        };

        const addCategory = async () => {
            const name = prompt('请输入分类名称：');
            if (name && name.trim()) {
                const newCategory = {
                    id: generateId(),
                    name: name.trim(),
                    parentId: null,
                    order: categories.value.length,
                    expanded: true
                };
                categories.value.push(newCategory);
                try {
                    await apiPost('/categories', newCategory);
                } catch (err) {
                    console.error('创建分类失败，保存快照回退：', err);
                    saveData();
                }
            }
        };

        // 重命名分类：乐观更新，失败回退并保存快照
        const renameCategory = async (categoryId) => {
            const cat = categories.value.find(c => c.id === categoryId);
            if (!cat) return;
            const newName = prompt('输入新的分类名称：', cat.name);
            if (!newName || !newName.trim()) return;
            const oldName = cat.name;
            cat.name = newName.trim();
            try {
                await apiPut(`/categories/${encodeURIComponent(categoryId)}`, cat);
            } catch (err) {
                console.error('重命名分类失败，已回退并保存快照：', err);
                cat.name = oldName;
                saveData();
                alert('重命名失败，已回退并保存本地快照');
            }
        };

        // 安全调用重命名：避免模板直接调用时因绑定未初始化导致错误
        const safeRename = (categoryId) => {
            if (typeof renameCategory === 'function') {
                try {
                    renameCategory(categoryId);
                } catch (e) {
                    console.error('renameCategory 调用异常：', e);
                    alert('重命名失败，请查看控制台以获取详细信息。');
                }
            } else {
                console.warn('renameCategory 未定义，操作被忽略');
                alert('重命名功能当前不可用，请刷新页面或稍后重试。');
            }
        };

        // 修复分类 parentId：尝试将指向不存在 id 的 parentId 使用 name 映射或提升为根
        const fixCategoryParents = () => {
            const cats = categories.value;
            if (!Array.isArray(cats) || cats.length === 0) {
                alert('当前没有分类可修复。');
                return;
            }
            const idSet = new Set(cats.map(c => c.id));
            const nameToId = {};
            cats.forEach(c => { nameToId[c.name] = c.id; });
            let changed = 0;
            cats.forEach(c => {
                if (c.parentId && !idSet.has(c.parentId)) {
                    // 如果 parentId 看起来像名字，则尝试按 name 映射
                    if (nameToId[c.parentId]) {
                        c.parentId = nameToId[c.parentId];
                        changed++;
                    } else {
                        // 查找可能的父项（有时 parentId 存的是旧的导入 id 或 name）
                        const maybe = cats.find(x => x.id === c.parentId || x.name === c.parentId);
                        if (maybe) {
                            c.parentId = maybe.id;
                            changed++;
                        } else {
                            // 无法修复则设为 null（提升为根），但保留原值可选
                            c.parentId = null;
                            changed++;
                        }
                    }
                }
            });
            if (changed > 0) {
                saveData();
                alert('分类关系修复完成，修改数量：' + changed + '，已保存。');
            } else {
                alert('未发现需要修复的分类。');
            }
        };

        const filterByTag = (tagName) => {
            searchQuery.value = `tag:${tagName}`;
        };

        const openBookmark = (url) => {
            const bookmark = bookmarks.value.find(b => b.url === url);
            if (bookmark) {
                bookmark.visitCount = (bookmark.visitCount || 0) + 1;
                bookmark.lastVisited = new Date().toISOString();
                // 异步上报访问次数
                apiPut(`/bookmarks/${encodeURIComponent(bookmark.id)}`, bookmark).catch(err => {
                    console.warn('更新访问次数失败，保存快照：', err);
                    saveData();
                });
            }
            window.open(url, '_blank');
        };

        const editBookmark = (bookmark) => {
            editingBookmark.value = bookmark;
            bookmarkForm.value = {
                title: bookmark.title,
                url: bookmark.url,
                description: bookmark.description || '',
                category: bookmark.category || '',
                tags: bookmark.tags.join(', ')
            };
        };

        const deleteBookmark = async (bookmark) => {
            if (confirm(`确定要删除书签 "${bookmark.title}" 吗？`)) {
                // 乐观更新
                bookmarks.value = bookmarks.value.filter(b => b.id !== bookmark.id);
                try {
                    await apiDelete(`/bookmarks/${encodeURIComponent(bookmark.id)}`);
                } catch (err) {
                    console.error('删除书签失败，保存快照回退：', err);
                    saveData();
                }
            }
        };

        const saveBookmark = async () => {
            const formData = {
                ...bookmarkForm.value,
                tags: bookmarkForm.value.tags.split(',').map(tag => tag.trim()).filter(tag => tag)
            };

            if (editingBookmark.value) {
                // 编辑现有书签 - 乐观更新并调用 PUT
                const index = bookmarks.value.findIndex(b => b.id === editingBookmark.value.id);
                if (index !== -1) {
                    bookmarks.value[index] = {
                        ...bookmarks.value[index],
                        ...formData,
                        updatedAt: new Date().toISOString()
                    };
                    try {
                        await apiPut(`/bookmarks/${encodeURIComponent(editingBookmark.value.id)}`, bookmarks.value[index]);
                    } catch (err) {
                        console.error('更新书签失败，保存快照回退：', err);
                        saveData();
                    }
                }
            } else {
                // 添加新书签
                const newBookmark = {
                    id: generateId(),
                    ...formData,
                    favicon: `https://www.google.com/s2/favicons?domain=${new URL(formData.url).hostname}`,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    visitCount: 0
                };
                bookmarks.value.unshift(newBookmark);
                try {
                    await apiPost('/bookmarks', newBookmark);
                } catch (err) {
                    console.error('添加书签到后端失败，保存快照：', err);
                    saveData();
                }
            }

            cancelEdit();
        };

        const cancelEdit = () => {
            showAddBookmark.value = false;
            editingBookmark.value = null;
            bookmarkForm.value = {
                title: '',
                url: '',
                description: '',
                category: '',
                tags: ''
            };
        };

        const handleDragStart = (event, bookmark) => {
            draggedBookmark.value = bookmark;
            try {
                event.dataTransfer.effectAllowed = 'move';
                // 在 dataTransfer 上写入数据以提高跨浏览器兼容性（某些浏览器要求）
                event.dataTransfer.setData('text/plain', bookmark.id);
            } catch (e) {
                // 某些环境下可能不支持直接写入，忽略错误
            }
        };

        const handleDrop = (event, targetBookmark) => {
            event.preventDefault();
            if (draggedBookmark.value && draggedBookmark.value.id !== targetBookmark.id) {
                // 重新排序书签
                const draggedIndex = bookmarks.value.findIndex(b => b.id === draggedBookmark.value.id);
                const targetIndex = bookmarks.value.findIndex(b => b.id === targetBookmark.id);
                
                if (draggedIndex !== -1 && targetIndex !== -1) {
                    const [removed] = bookmarks.value.splice(draggedIndex, 1);
                    bookmarks.value.splice(targetIndex, 0, removed);
                    saveData();
                }
            }
            draggedBookmark.value = null;
        };

        const handleDragEnd = (event) => {
            // 清理拖拽状态
            draggedBookmark.value = null;
        };

        // 分类节点开始拖拽（用于重排）
        const handleCategoryDragStart = (event, category) => {
            draggedCategoryId.value = category.id;
            try {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', `category:${category.id}`);
            } catch (e) {}
        };

        const handleCategoryDragEnd = (event) => {
            draggedCategoryId.value = null;
            hoveredCategoryId.value = null;
        };

        const handleCategoryDragEnter = (event, categoryId) => {
            hoveredCategoryId.value = categoryId;
        };

        const handleCategoryDragLeave = (event, categoryId) => {
            // 简单处理：离开时清除高亮（浏览器事件可能多次触发，但效果可接受）
            hoveredCategoryId.value = null;
        };

        // 右键删除分类（确认并删除分类及其子分类，受影响书签归到上级或置空）
        const confirmDeleteCategory = (category) => {
            if (!category || !category.id) return;
            // 收集要删除的分类及其子孙
            const collectDescendants = (id) => {
                const ids = [id];
                for (let i = 0; i < ids.length; i++) {
                    const pid = ids[i];
                    categories.value.forEach(c => {
                        if (c.parentId === pid) ids.push(c.id);
                    });
}
                return ids;
            };

            const idsToDelete = collectDescendants(category.id);
            const affectedBookmarks = bookmarks.value.filter(b => idsToDelete.includes(b.category));

            const msg = `确定删除分类 "${category.name}" 及其 ${idsToDelete.length - 1} 个子分类吗？\n将有 ${affectedBookmarks.length} 个书签受到影响（会移动至上级或取消分类）。此操作可撤销。`;
            if (!confirm(msg)) return;

            // 备份全量状态以便撤销（简单且安全）
            const prevState = {
                categories: JSON.parse(JSON.stringify(categories.value)),
                bookmarks: JSON.parse(JSON.stringify(bookmarks.value))
            };

            // 执行删除：移除分类
            categories.value = categories.value.filter(c => !idsToDelete.includes(c.id));

            // 将受影响书签的分类设为其原分类的 parentId 或空
            affectedBookmarks.forEach(b => {
                const originalCat = prevState.categories.find(c => c.id === b.category);
                b.category = originalCat ? (originalCat.parentId || '') : '';
            });

            saveData();
            // 推入撤销栈
            undoStack.value.push({ type: 'delete-category', prev: prevState });
            scheduleUndoToast('已删除分类，撤销', true);
        };

        // 当把一个分类拖到另一个分类上以重排
        const handleCategoryReorderDrop = (targetCategoryId, event) => {
            event.preventDefault();
            try {
                const data = event.dataTransfer.getData('text/plain');
                if (data && data.startsWith('category:')) {
                    const sourceId = data.split(':')[1];
                    if (!sourceId || sourceId === targetCategoryId) return;
                    // 防止将分类移动到自己的子孙中
                    const isDescendant = (maybeDesc, ancestorId) => {
                        if (!maybeDesc) return false;
                        let cur = categories.value.find(c => c.id === maybeDesc);
                        while (cur) {
                            if (cur.parentId === ancestorId) return true;
                            cur = categories.value.find(c => c.id === cur.parentId);
                        }
                        return false;
                    };
                    if (isDescendant(targetCategoryId, sourceId)) {
                        // 不允许把祖先移动到自己的子孙下
                        return;
                    }
                    const srcIndex = categories.value.findIndex(c => c.id === sourceId);
                    const tgtIndex = categories.value.findIndex(c => c.id === targetCategoryId);
                    if (srcIndex === -1 || tgtIndex === -1) return;

                    // 记录原始顺序以便撤销
                    const prevOrder = categories.value.map(c => ({ id: c.id, parentId: c.parentId, order: c.order }));

                    // 根据 hoveredDropMode 决定插入方式
                    const mode = hoveredDropMode.value || 'after';
                    const source = categories.value.splice(srcIndex, 1)[0];
                    if (mode === 'child') {
                        // 作为子分类：设置 parentId 为 target，并插入到该 target 后面（作为第一个/或最后一个子项）
                        source.parentId = targetCategoryId;
                        // 找到 target 在数组中的位置，然后插入到最后一个子项之后或直接在 target 后
                        const childIndices = categories.value
                            .map((c, i) => ({ c, i }))
                            .filter(x => x.c.parentId === targetCategoryId)
                            .map(x => x.i);
                        let insertIndex = categories.value.findIndex(c => c.id === targetCategoryId) + 1;
                        if (childIndices.length > 0) insertIndex = Math.max(...childIndices) + 1;
                        categories.value.splice(insertIndex, 0, source);
                    } else if (mode === 'before') {
                        source.parentId = categories.value[tgtIndex > srcIndex ? tgtIndex - 1 : tgtIndex].parentId || null;
                        const insertIndex = categories.value.findIndex(c => c.id === targetCategoryId);
                        categories.value.splice(insertIndex, 0, source);
                    } else { // after
                        source.parentId = categories.value[tgtIndex > srcIndex ? tgtIndex - 1 : tgtIndex].parentId || null;
                        const insertIndex = categories.value.findIndex(c => c.id === targetCategoryId) + 1;
                        categories.value.splice(insertIndex, 0, source);
                    }

                    // 重新归一 order 字段（按数组顺序）
                    categories.value.forEach((c, idx) => c.order = idx);
                    saveData();

                    // 推入撤销栈
                    undoStack.value.push({ type: 'reorder', prev: prevOrder });
                    scheduleUndoToast('已移动分类，撤销', true);
                }
            } catch (e) {
                console.error('分类重排失败', e);
            } finally {
                draggedCategoryId.value = null;
                hoveredCategoryId.value = null;
                hoveredDropMode.value = null;
            }
        };

        // 更精细的 dragover，用于判断插入位置（同级前/子级/同级后）并显示提示文本
        const handleCategoryDragOver = (event, categoryId) => {
            event.preventDefault();
            const el = event.currentTarget;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const y = event.clientY - rect.top;
            const h = rect.height || 1;
            let mode = 'child';
            if (y < h * 0.25) mode = 'before';
            else if (y > h * 0.75) mode = 'after';
            else mode = 'child';
            hoveredCategoryId.value = categoryId;
            hoveredDropMode.value = mode;
        };

        // 决策型的 drop 处理：如果是 category: 则触发重排，否则当作书签放置
        const handleCategoryDropOrReorder = (categoryId, event) => {
            event.preventDefault();
            try {
                const data = event.dataTransfer.getData('text/plain');
                if (data && data.startsWith('category:')) {
                    handleCategoryReorderDrop(categoryId, event);
                    return;
                }
            } catch (e) {
                // ignore
            }
            // 否则当作书签或外部链接放置
            handleCategoryDrop(categoryId, event);
        };

        // 撤销提示显示与定时器
        const scheduleUndoToast = (message, autoHide = true) => {
            undoMessage.value = message || '可撤销操作';
            undoToast.value = true;
            if (undoTimer) clearTimeout(undoTimer);
            if (autoHide) {
                undoTimer = setTimeout(() => {
                    undoToast.value = false;
                    undoTimer = null;
                }, 8000);
            }
        };

        // 执行撤销操作（弹出 undoStack 中最新的一项并回退）
        async function undoLastAction() {
            if (!undoStack.value || undoStack.value.length === 0) return;
            const last = undoStack.value.pop();
            try {
                if (last.type === 'delete-category' && last.prev) {
                    // 还原完整的 prev 状态
                    categories.value = last.prev.categories || categories.value;
                    bookmarks.value = last.prev.bookmarks || bookmarks.value;
                    await saveData();
                } else if (last.type === 'reorder' && Array.isArray(last.prev)) {
                    // last.prev 是一个数组，包含 {id, parentId, order}
                    const map = {};
                    last.prev.forEach(p => { map[p.id] = p; });
                    categories.value.forEach(c => {
                        if (map[c.id]) {
                            c.parentId = map[c.id].parentId;
                            c.order = map[c.id].order;
                        }
                    });
                    // 以 order 排序
                    categories.value.sort((a,b)=> (a.order||0) - (b.order||0));
                    await saveData();
                } else if (last.type === 'add' && Array.isArray(last.items)) {
                    // 删除之前新增的项（通常是书签 id 列表）
                    const ids = new Set(last.items);
                    bookmarks.value = bookmarks.value.filter(b => !ids.has(b.id));
                    await saveData();
                } else if (last.type === 'move' && Array.isArray(last.items)) {
                    // items: [{id, from}]
                    last.items.forEach(it => {
                        const b = bookmarks.value.find(x => x.id === it.id);
                        if (b) b.category = it.from || '';
                    });
                    await saveData();
                }
                scheduleUndoToast('撤销成功', true);
            } catch (err) {
                console.error('撤销失败：', err);
                alert('撤销失败，请查看控制台');
            } finally {
                undoToast.value = false;
                if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
            }
        }

        // 处理书签拖拽到分类树节点（放在 setup 内以访问响应式引用）
        const handleCategoryDrop = (categoryId, event) => {
            event.preventDefault();
            // 优先处理外部拖入的 URL（例如从浏览器拖拽链接）
            try {
                const dt = event.dataTransfer;
                const textUri = dt.getData('text/uri-list') || dt.getData('text/plain');
                // 如果 data 包含 http 且不是我们内部 category/bookmark id，则当作外部链接
                if (textUri && /https?:\/\//.test(textUri) && !textUri.startsWith('category:') && !textUri.startsWith('bookmark:')) {
                    const url = textUri.split('\n')[0].trim();
                    const newBookmark = {
                        id: generateId(),
                        title: url,
                        url: url,
                        description: '',
                        favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}`,
                        category: categoryId,
                        tags: [],
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        visitCount: 0
                    };
                    // 乐观更新 UI
                    bookmarks.value.unshift(newBookmark);
                    // 持久化到后端
                    apiPost('/bookmarks', newBookmark).then(()=>{
                        // 已保存
                    }).catch(err=>{
                        console.warn('保存外部拖入书签到后端失败，保存快照：', err);
                        saveData();
                    });
                    // 记录撤销信息
                    undoStack.value.push({ type: 'add', items: [newBookmark.id] });
                    scheduleUndoToast('已添加外部链接，撤销', true);
                    return;
                }
            } catch (e) {
                // 忽略解析错误，回退到内部拖拽处理
            }

            // 支持单个和批量内部拖拽
            const dragged = draggedBookmark.value;
            if (!dragged) return;

            // 决定要移动的 id 列表，并记录原始分类以便撤销
            let idsToMove = [dragged.id];
            if (bulkMode.value && selectedIds.value.length > 0 && selectedIds.value.includes(dragged.id)) {
                idsToMove = [...selectedIds.value];
            }
            const prev = [];
            bookmarks.value.forEach(b => {
                if (idsToMove.includes(b.id)) {
                    prev.push({ id: b.id, from: b.category });
                }
            });
            // 执行移动（乐观更新并逐个 PUT）
            bookmarks.value.forEach(b => {
                if (idsToMove.includes(b.id)) {
                    b.category = categoryId;
                    b.updatedAt = new Date().toISOString();
                }
            });
            // 异步同步到后端
            Promise.all(idsToMove.map(id => {
                const b = bookmarks.value.find(x => x.id === id);
                return apiPut(`/bookmarks/${encodeURIComponent(id)}`, b).catch(e => { throw e; });
            })).catch(err => {
                console.error('移动书签到分类失败，保存快照回退：', err);
                saveData();
            });
            draggedBookmark.value = null;
            // 推入撤销栈
            undoStack.value.push({ type: 'move', items: prev });
            scheduleUndoToast('已移动书签，撤销', true);
            // 可选：清除批量选择
            if (bulkMode.value) clearSelection();
        };

        const importBookmarks = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            event.target.value = '';
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const content = e.target.result;
                    let importedBookmarks = [];
                    let importedCategories = [];
                    if (file.name.endsWith('.json')) {
                        const data = JSON.parse(content);
                        importedBookmarks = data.bookmarks || [];
                        importedCategories = data.categories || [];
                    } else if (file.name.endsWith('.html')) {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(content, 'text/html');

                        // 尝试基于 NETSCAPE 书签的 DL/DT/H3 结构递归解析文件，保留分类层级关系
                        const topDL = doc.querySelector('dl');
                        const cats = [];
                        const bms = [];

                        // 兼容所有主流浏览器导出的书签格式，递归采集所有 <A> 书签和 <H3> 分类
                        const resolveDLName = (startEl) => {
                            try {
                                if (!startEl) return '';
                                // 从当前元素开始，向上和向前查找最近的 <H3>
                                let el = startEl;
                                for (let depth = 0; depth < 8 && el; depth++) {
                                    // 在当前层级，向前搜索前面的兄弟节点
                                    let sib = el.previousElementSibling;
                                    while (sib) {
                                        if (sib.tagName && sib.tagName.toLowerCase() === 'dt') {
                                            // <DT> 内可能包含 <H3>
                                            const h3 = sib.querySelector('h3');
                                            if (h3 && h3.textContent && h3.textContent.trim()) return h3.textContent.trim();
                                        }
                                        // 有些导出把 H3 放在更前的位置，直接检查 sib 是否为 H3
                                        if (sib.tagName && sib.tagName.toLowerCase() === 'h3') {
                                            if (sib.textContent && sib.textContent.trim()) return sib.textContent.trim();
                                        }
                                        sib = sib.previousElementSibling;
                                    }
                                    // 没找到，向上到父元素继续查找（例如 DL 的父节点可能是 DT）
                                    el = el.parentElement;
                                }
                                // 作为兜底，直接在文档中寻找距离此节点最近的 H3（遍历所有 H3，取位置最靠前但在 startEl 之前的）
                                try {
                                    const allH3 = doc.querySelectorAll('h3');
                                    let candidate = '';
                                    let lastIndex = -1;
                                    for (let i = 0; i < allH3.length; i++) {
                                        const h = allH3[i];
                                        if (h.compareDocumentPosition && startEl.compareDocumentPosition) {
                                            // 如果 h 在 startEl 之前
                                            const pos = h.compareDocumentPosition(startEl);
                                            // DOCUMENT_POSITION_FOLLOWING === 4 means h is before startEl
                                            if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
                                                candidate = h.textContent.trim();
                                                break;
                                            }
                                        }
                                    }
                                    return candidate || '';
                                } catch (e) {
                                    return '';
                                }
                            } catch (e) {
                                return '';
                            }
                        };

                        const processDL = (dlElement, parentId = '', parentName = '') => {
                            if (!dlElement) return;
                            let node = dlElement.firstElementChild;
                            while (node) {
                                if (node.tagName && node.tagName.toLowerCase() === 'dt') {
                                    // 先查找 <H3> 分类
                                    let h3 = null, a = null;
                                    for (let child = node.firstElementChild; child; child = child.nextElementSibling) {
                                        if (child.tagName) {
                                            const tag = child.tagName.toLowerCase();
                                            if (tag === 'h3') h3 = child;
                                            else if (tag === 'a') a = child;
                                        }
                                    }
                                    // 兼容 <DT><A ...></A></DT> 结构
                                    if (!h3 && !a && node.tagName.toLowerCase() === 'dt' && node.firstElementChild && node.firstElementChild.tagName && node.firstElementChild.tagName.toLowerCase() === 'a') {
                                        a = node.firstElementChild;
                                    }
                                    if (h3) {
                                        const catId = generateId();
                                        const name = h3.textContent.trim();
                                        const cat = { id: catId, name, parentId: parentId || null, order: cats.length, expanded: true };
                                        cats.push(cat);
                                        // 查找下一个兄弟节点 <DL> 作为子分类/子书签
                                        let next = node.nextElementSibling;
                                        if (next && next.tagName && next.tagName.toLowerCase() === 'dl') {
                                            processDL(next, catId, name);
                                        }
                                    }
                                    if (a) {
                                        // 普通书签项
                                        const title = a.textContent.trim();
                                        const url = a.href;
                                        const addDateAttr = a.getAttribute('add_date') || a.getAttribute('ADD_DATE') || a.getAttribute('add_date');
                                        const createdAt = addDateAttr ? new Date(parseInt(addDateAttr, 10) * 1000).toISOString() : new Date().toISOString();
                                        // 尝试记录 categoryName（如果 parentName 可用则用它，否则尝试根据 dlElement 推断）
                                        const inferredName = parentName || resolveDLName(dlElement) || '';
                                        bms.push({ id: generateId(), title, url, description: '', favicon: a.getAttribute('icon') || '', category: parentId || '', categoryName: inferredName, tags: [], createdAt, updatedAt: createdAt, visitCount: 0 });
                                    }
                                    // 递归处理 <DT> 内部的 <DL>（有些结构是 <DT>...<DL>...</DL>）
                                    const innerDL = node.querySelector(':scope > dl');
                                    if (innerDL) processDL(innerDL, parentId, parentName);
                                }
                                node = node.nextElementSibling;
                            }
                        };

                        if (topDL) {
                            processDL(topDL, '');
                        } else {
                            // 兜底：找所有链接，归到根
                            const links = doc.querySelectorAll('a');
                            links.forEach(link => {
                                bms.push({ id: generateId(), title: link.textContent.trim(), url: link.href, description: '', favicon: link.getAttribute('icon') || '', category: '', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), visitCount: 0 });
                            });
                        }

                        importedCategories = cats;
                        importedBookmarks = bms;
                        // 调试输出，方便定位采集问题
                        console.log('[HTML导入调试] 采集到分类数:', cats.length, cats.slice(0,5));
                        console.log('[HTML导入调试] 采集到书签数:', bms.length, bms.slice(0,5));
                        // 输出样例的 categoryName 字段，帮助判断解析是否成功
                        console.log('[HTML导入调试] 书签样例 categoryName 字段:', bms.slice(0,10).map(x=>({title:x.title, category:x.category, categoryName:x.categoryName})).slice(0,10));
                    }
                    if (importedBookmarks.length > 0) {
                        // 调试：查看导入书签中 category 字段的分布，帮助定位映射问题
                        const emptyCat = importedBookmarks.filter(b => !b.category).length;
                        const nonEmptyCat = importedBookmarks.length - emptyCat;
                        const sampleCats = Array.from(new Set(importedBookmarks.map(b => b.category).filter(Boolean))).slice(0,10);
                        console.log('[HTML导入调试] 导入书签 category 分布: total=', importedBookmarks.length, 'empty=', emptyCat, 'nonEmpty=', nonEmptyCat, 'sampleNonEmpty=', sampleCats);
                        // 确保默认分类存在，避免映射到空
                        ensureDefaultCategory();
                        // 合并分类（只添加新分类）
                        // Build existing category lookup (normalized by name) and id set
                        const existingIdSet = new Set();
                        const existingNameToId = {};
                        categories.value.forEach(cat => { existingIdSet.add(cat.id); existingNameToId[(cat.name||'').trim().toLowerCase()] = cat.id; });

                        // Decide which imported categories are new (by id or normalized name)
                        const newCategories = [];
                        importedCategories.forEach(ic => {
                            const normName = (ic.name||'').trim().toLowerCase();
                            if (existingIdSet.has(ic.id)) return; // already present by id
                            if (existingNameToId[normName]) return; // name already exists
                            // ensure imported category uses trimmed name
                            ic.name = (ic.name || '').trim();
                            newCategories.push(ic);
                        });

                        // push new categories (keep their ids)
                        if (newCategories.length > 0) {
                            categories.value.push(...newCategories);
                        }

                        // Rebuild name->id map after adding new categories (normalized)
                        const nameToId = {};
                        categories.value.forEach(cat => { nameToId[(cat.name||'').trim().toLowerCase()] = cat.id; });

                        // Build mapping from imported category id -> final id (after merge)
                        const importedIdToFinalId = {};
                        importedCategories.forEach(ic => {
                            const normName = (ic.name||'').trim().toLowerCase();
                            if (existingIdSet.has(ic.id)) importedIdToFinalId[ic.id] = ic.id;
                            else if (nameToId[normName]) importedIdToFinalId[ic.id] = nameToId[normName];
                            else importedIdToFinalId[ic.id] = ic.id; // fallback to imported id (we pushed it)
                        });

                        // Remap parentId for categories in categories.value if they reference an imported id
                        categories.value.forEach(cat => {
                            if (cat.parentId && importedIdToFinalId[cat.parentId]) {
                                const finalPid = importedIdToFinalId[cat.parentId];
                                if (cat.parentId !== finalPid) cat.parentId = finalPid;
                            }
                        });
                        // 网址去重合并
                        let mergedCount = 0;
                        let mappedToDefault = 0;
                        let mappedToExisting = 0;
                        let mappedByName = 0;
                        importedBookmarks.forEach(imported => {
                            // 分类归类：支持两种情况
                            // 1) imported.category is an imported category id -> map via importedIdToFinalId
                            // 2) imported.category is a category name -> map via nameToId
                            // Normalize category mapping: prefer imported.category (id), then imported.categoryName (name), then fallback to DEFAULT
                            let finalCat = '';
                            if (imported.category) {
                                const catKey = (imported.category || '').toString().trim();
                                if (importedIdToFinalId[catKey]) finalCat = importedIdToFinalId[catKey];
                                else if (nameToId[catKey.toLowerCase()]) finalCat = nameToId[catKey.toLowerCase()];
                            }
                            if (!finalCat && imported.categoryName) {
                                const norm = (imported.categoryName || '').trim().toLowerCase();
                                if (nameToId[norm]) finalCat = nameToId[norm];
                            }
                            if (!finalCat) finalCat = DEFAULT_CATEGORY_ID;
                            imported.category = finalCat;

                            // 统计映射情况
                            if (imported.category === DEFAULT_CATEGORY_ID) mappedToDefault++; else mappedToExisting++;
                            if (imported.categoryName && imported.category && imported.category !== DEFAULT_CATEGORY_ID) mappedByName++;

                            // 查找是否已存在同网址
                            const exist = bookmarks.value.find(b => b.url === imported.url);
                            if (exist) {
                                // 合并：标签并集，描述以新为准，访问数取最大，更新时间为新
                                exist.tags = Array.from(new Set([...(exist.tags||[]), ...(imported.tags||[])]));
                                if (imported.description) exist.description = imported.description;
                                if (imported.favicon) exist.favicon = imported.favicon;
                                exist.visitCount = Math.max(exist.visitCount||0, imported.visitCount||0);
                                exist.updatedAt = new Date().toISOString();
                                mergedCount++;
                            } else {
                                bookmarks.value.unshift(imported);
                            }
                        });
                        console.log('[HTML导入调试] 映射结果：mappedToExisting=', mappedToExisting, 'mappedToDefault=', mappedToDefault, 'mappedByName=', mappedByName, 'mergedCount=', mergedCount);
                        // 将导入数据发送到后端以持久化（合并导入）
                        try {
                            await apiPost('/import', {
                                categories: importedCategories.map(c=>({ ...c })),
                                bookmarks: importedBookmarks.map(b=>({ ...b }))
                            });
                            // 重新从后端加载最新数据
                            await loadData();
                            let msg = `成功导入 ${importedBookmarks.length - mergedCount} 个书签！`;
                            if (newCategories.length > 0) msg += ` 新增分类 ${newCategories.length} 个。`;
                            if (mergedCount > 0) msg += ` 有 ${mergedCount} 个网址已存在，已自动合并。`;
                            alert(msg);
                        } catch (err) {
                            console.error('导入到后端失败，已回退到 localStorage：', err);
                            saveData();
                            alert('导入失败：无法将数据保存至后端，已保存到 localStorage');
                        }
                    } else {
                        alert('未找到可导入的书签数据。');
                    }
                } catch (error) {
                    console.error('导入错误:', error);
                    alert('导入失败：文件格式可能不正确或文件已损坏。');
                }
            };
            reader.onerror = () => {
                alert('文件读取失败，请检查文件是否有效。');
            };
            reader.readAsText(file);
        };

        // 从当前浏览器 localStorage 一键导入到后端数据库（迁移按钮使用）
        const importLocalStorage = async () => {
            const raw = localStorage.getItem(APP_CONFIG.storageKey);
            if (!raw) { alert('未检测到本地 localStorage 数据'); return; }
            try {
                const data = JSON.parse(raw);
                const categoriesToSend = data.categories || [];
                const bookmarksToSend = data.bookmarks || [];
                await apiPost('/import', { categories: categoriesToSend, bookmarks: bookmarksToSend });
                await loadData();
                alert('已将 localStorage 数据导入后端数据库');
            } catch (err) {
                console.error('localStorage 导入失败：', err);
                alert('导入失败，请查看控制台');
            }
        };

        const exportBookmarks = (format) => {
            let content = '';
            let filename = `bookmarks_${new Date().toISOString().split('T')[0]}`;

            if (format === 'json') {
                content = JSON.stringify({
                    bookmarks: bookmarks.value,
                    categories: categories.value,
                    exportDate: new Date().toISOString()
                }, null, 2);
                filename += '.json';
            } else if (format === 'html') {
                // 生成 Chrome/Chrome-compatible 的书签 HTML（保留分类树与子分类）
                const escapeHtml = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                const header = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>`;

                const buildCategoryHtml = (cats) => {
                    return cats.map(cat => {
                        const lines = [];
                        lines.push(`    <DT><H3>${escapeHtml(cat.name)}</H3>`);
                        lines.push('    <DL><p>');

                        // 当前分类下的书签（不包含子分类内的书签）
                        const bms = bookmarks.value.filter(b => b.category === cat.id);
                        bms.forEach(b => {
                            const addDate = Math.floor(new Date(b.createdAt).getTime() / 1000) || Math.floor(Date.now() / 1000);
                            lines.push(`        <DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${addDate}">${escapeHtml(b.title)}</A>`);
                        });

                        // 递归子分类
                        if (cat.children && cat.children.length) {
                            lines.push(buildCategoryHtml(cat.children));
                        }

                        lines.push('    </DL><p>');
                        return lines.join('\n');
                    }).join('\n');
                };

                // 根级别输出：先输出没有分类的书签
                const rootLines = [];
                rootLines.push('<DL><p>');
                const rootBookmarks = bookmarks.value.filter(b => !b.category);
                rootBookmarks.forEach(b => {
                    const addDate = Math.floor(new Date(b.createdAt).getTime() / 1000) || Math.floor(Date.now() / 1000);
                    rootLines.push(`    <DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${addDate}">${escapeHtml(b.title)}</A>`);
                });

                if (categoryTree.value && categoryTree.value.length) {
                    rootLines.push(buildCategoryHtml(categoryTree.value));
                }
                rootLines.push('</DL><p>');

                content = `${header}\n${rootLines.join('\n')}`;
                filename += '.html';
            }

            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            return;
        };

        const backupData = () => {
            const backup = {
                bookmarks: bookmarks.value,
                categories: categories.value,
                version: APP_CONFIG.version,
                backupDate: new Date().toISOString()
            };
            
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bookmark-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
        };

        const clearAllData = () => {
            if (confirm('确定要清空所有数据吗？此操作不可恢复！')) {
                localStorage.removeItem(APP_CONFIG.storageKey);
                bookmarks.value = [];
                categories.value = [];
                initializeSampleData();
            }
        };

        const formatDate = (dateString) => {
            const date = new Date(dateString);
            return date.toLocaleDateString('zh-CN');
        };

        // 初始化Pixi.js背景效果
        const initParticles = () => {
            const canvas = document.getElementById('particles-canvas');
            if (!canvas) return;

            const app = new PIXI.Application({
                view: canvas,
                width: window.innerWidth,
                height: window.innerHeight,
                backgroundColor: 0xf7fafc,
                backgroundAlpha: 0
            });

            const particles = [];
            const particleCount = 50;

            for (let i = 0; i < particleCount; i++) {
                const particle = new PIXI.Graphics();
                particle.beginFill(0x3b82f6, 0.1);
                particle.drawCircle(0, 0, Math.random() * 3 + 1);
                particle.endFill();
                
                particle.x = Math.random() * app.screen.width;
                particle.y = Math.random() * app.screen.height;
                particle.vx = (Math.random() - 0.5) * 0.5;
                particle.vy = (Math.random() - 0.5) * 0.5;
                
                app.stage.addChild(particle);
                particles.push(particle);
            }

            app.ticker.add(() => {
                particles.forEach(particle => {
                    particle.x += particle.vx;
                    particle.y += particle.vy;
                    
                    if (particle.x < 0) particle.x = app.screen.width;
                    if (particle.x > app.screen.width) particle.x = 0;
                    if (particle.y < 0) particle.y = app.screen.height;
                    if (particle.y > app.screen.height) particle.y = 0;
                });
            });

            // 响应窗口大小变化
            window.addEventListener('resize', () => {
                app.renderer.resize(window.innerWidth, window.innerHeight);
            });
        };

        // 生命周期钩子
        onMounted(() => {
            loadData();
            initParticles();
            
            // 添加键盘快捷键
            document.addEventListener('keydown', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    switch (e.key) {
                        case 'k':
                            e.preventDefault();
                            document.querySelector('input[type="text"]').focus();
                            break;
                        case 'n':
                            e.preventDefault();
                            showAddBookmark.value = true;
                            break;
                    }
                }
            });
        });

        // 数据持久化
        watch([bookmarks, categories], () => {
            saveData();
        }, { deep: true });

        // 搜索时重置页码
        watch(searchQuery, () => {
            currentPage.value = 1;
        });

        watch(selectedCategory, () => {
            currentPage.value = 1;
        });

        // 返回模板中需要使用的数据和方法
            console.log('[main.js] before return typeof undoLastAction =', typeof undoLastAction);
            return {
            // 数据
            bookmarks,
            categories,
            searchQuery,
            selectedCategory,
            viewMode,
            sortBy,
            currentPage,
            sidebarOpen,
            showAddBookmark,
            showImportExport,
            editingBookmark,
            bookmarkForm,
            selectedCategoryName,
            directBookmarkCount,
            totalBookmarkCount,            // 计算属性
            categoryTree,
            flatCategories,
            popularTags,
            filteredBookmarks,
            totalPages,
            paginatedBookmarks,
            selectedIds,
            selectedCount,
            bulkMoveTarget,
            bulkMode,
            isAllSelectedOnPage,
            
            // 方法
            toggleSidebar,
            selectCategory,
            toggleCategory,
            addCategory,
            renameCategory,
            safeRename,
            fixCategoryParents,
            confirmDeleteCategory,
            filterByTag,
            openBookmark,
            editBookmark,
            deleteBookmark,
            saveBookmark,
            cancelEdit,
            handleDragStart,
            handleDrop,
            importBookmarks,
            importLocalStorage,
            handleCategoryDrop,
            handleDragEnd,
            // 分类拖拽/重排相关
            handleCategoryDragStart,
            handleCategoryDragEnd,
            handleCategoryDragEnter,
            handleCategoryDragLeave,
            handleCategoryDropOrReorder,
            handleCategoryReorderDrop,
            handleCategoryDragOver,
            hoveredCategoryId,
            hoveredDropMode,
            // 撤销相关
            undoToast,
            undoMessage,
            undoLastAction,
            exportBookmarks,
            backupData,
            clearAllData,
            formatDate
            ,toggleSelect, selectAllOnPage, clearSelection, deleteSelected, moveSelectedToCategory, toggleBulkMode, handleItemClick
        };
    }
});

// 挂载应用
app.mount('#app');