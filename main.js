// Vue 3 应用主文件
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
        const loadData = () => {
            try {
                const data = localStorage.getItem(APP_CONFIG.storageKey);
                if (data) {
                    const parsed = JSON.parse(data);
                    bookmarks.value = parsed.bookmarks || [];
                    categories.value = parsed.categories || [];
                } else {
                    // 初始化示例数据
                    initializeSampleData();
}
            } catch (error) {
                console.error('加载数据失败:', error);
                initializeSampleData();
            }
        };

        const saveData = () => {
            try {
                const data = {
                    bookmarks: bookmarks.value,
                    categories: categories.value,
                    version: APP_CONFIG.version,
                    lastUpdated: new Date().toISOString()
                };
                localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(data));
            } catch (error) {
                console.error('保存数据失败:', error);
            }
        };

        const initializeSampleData = () => {
            categories.value = [
                { id: 'work', name: '工作', parentId: null, order: 0 },
                { id: 'tools', name: '开发工具', parentId: 'work', order: 0 },
                { id: 'docs', name: '技术文档', parentId: 'work', order: 1 },
                { id: 'personal', name: '个人', parentId: null, order: 1 },
                { id: 'entertainment', name: '娱乐', parentId: 'personal', order: 0 },
                { id: 'learning', name: '学习', parentId: 'personal', order: 1 },
                { id: 'shopping', name: '购物', parentId: null, order: 2 }
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

            saveData();
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

        const deleteSelected = () => {
            if (selectedIds.value.length === 0) return;
            if (!confirm(`确定要删除所选的 ${selectedIds.value.length} 个书签吗？此操作不可恢复！`)) return;
            bookmarks.value = bookmarks.value.filter(b => !selectedIds.value.includes(b.id));
            saveData();
            clearSelection();
        };

        const moveSelectedToCategory = (categoryId) => {
            if (!categoryId) return;
            if (selectedIds.value.length === 0) return;
            bookmarks.value.forEach(b => {
                if (selectedIds.value.includes(b.id)) b.category = categoryId;
            });
            saveData();
            clearSelection();
        };

        const addCategory = () => {
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
                saveData();
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
                saveData();
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

        const deleteBookmark = (bookmark) => {
            if (confirm(`确定要删除书签 "${bookmark.title}" 吗？`)) {
                bookmarks.value = bookmarks.value.filter(b => b.id !== bookmark.id);
                saveData();
            }
        };

        const saveBookmark = () => {
            const formData = {
                ...bookmarkForm.value,
                tags: bookmarkForm.value.tags.split(',').map(tag => tag.trim()).filter(tag => tag)
            };

            if (editingBookmark.value) {
                // 编辑现有书签
                const index = bookmarks.value.findIndex(b => b.id === editingBookmark.value.id);
                if (index !== -1) {
                    bookmarks.value[index] = {
                        ...bookmarks.value[index],
                        ...formData,
                        updatedAt: new Date().toISOString()
                    };
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
            }

            saveData();
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
                    bookmarks.value.unshift(newBookmark);
                    saveData();
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

            // 执行移动
            bookmarks.value.forEach(b => {
                if (idsToMove.includes(b.id)) {
                    b.category = categoryId;
                    b.updatedAt = new Date().toISOString();
                }
            });
            saveData();
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
            reader.onload = (e) => {
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
                        const links = doc.querySelectorAll('a');
                        const folders = doc.querySelectorAll('h3');
                        importedBookmarks = Array.from(links).map(link => {
                            let categoryName = '';
                            let parentElement = link.parentElement;
                            while (parentElement && parentElement !== doc.body) {
                                const h3 = parentElement.querySelector('h3');
                                if (h3) {
                                    categoryName = h3.textContent.trim();
                                    break;
                                }
                                parentElement = parentElement.parentElement;
                            }
                            return {
                                id: generateId(),
                                title: link.textContent.trim(),
                                url: link.href,
                                description: link.getAttribute('description') || '',
                                favicon: link.getAttribute('icon') || '',
                                category: categoryName,
                                tags: [],
                                createdAt: new Date().toISOString(),
                                updatedAt: new Date().toISOString(),
                                visitCount: 0
                            };
                        });
                        importedCategories = Array.from(folders).map(folder => ({
                            id: generateId(),
                            name: folder.textContent.trim(),
                            parentId: null,
                            order: importedCategories.length,
                            expanded: true
                        }));
                    }
                    if (importedBookmarks.length > 0) {
                        // 合并分类（只添加新分类）
                        const existingCategoryNames = categories.value.map(cat => cat.name);
                        const newCategories = importedCategories.filter(cat =>
                            !existingCategoryNames.includes(cat.name)
                        );
                        if (newCategories.length > 0) {
                            categories.value.push(...newCategories);
                        }
                        // 分类名->id 映射
                        const categoryNameToId = {};
                        categories.value.forEach(cat => {
                            categoryNameToId[cat.name] = cat.id;
                        });
                        // 网址去重合并
                        let mergedCount = 0;
                        importedBookmarks.forEach(imported => {
                            // 分类归类
                            if (imported.category && categoryNameToId[imported.category]) {
                                imported.category = categoryNameToId[imported.category];
                            } else {
                                imported.category = '';
                            }
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
                        saveData();
                        let msg = `成功导入 ${importedBookmarks.length} 个书签！`;
                        if (newCategories.length > 0) msg += ` 新增分类 ${newCategories.length} 个。`;
                        if (mergedCount > 0) msg += ` 有 ${mergedCount} 个网址已存在，已自动合并。`;
                        alert(msg);
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
                // 生成Chrome兼容的书签HTML格式
                content = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${bookmarks.value.map(bookmark => 
    `    <DT><A HREF="${bookmark.url}" ADD_DATE="${Math.floor(new Date(bookmark.createdAt).getTime() / 1000)}">${bookmark.title}</A>`
).join('\n')}
</DL><p>`;
                filename += '.html';
            }

            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        };

        // 安排显示撤销吐司，并在超时后自动隐藏
        const scheduleUndoToast = (message, autoHide = true) => {
            undoMessage.value = message;
            undoToast.value = true;
            if (undoTimer) clearTimeout(undoTimer);
            if (autoHide) {
                undoTimer = setTimeout(() => {
                    undoToast.value = false;
                    // 弹窗消失时保留撤销记录一段时间或直接清理。这里选择清理以避免无限增长。
                    undoStack.value = [];
                }, 6000);
            }
        };

        const undoLastAction = () => {
            const action = undoStack.value.pop();
            if (!action) return;
            if (action.type === 'move') {
                action.items.forEach(item => {
                    const b = bookmarks.value.find(bb => bb.id === item.id);
                    if (b) b.category = item.from;
                });
            } else if (action.type === 'add') {
                // 删除已添加的书签
                action.items.forEach(id => {
                    const idx = bookmarks.value.findIndex(b => b.id === id);
                    if (idx !== -1) bookmarks.value.splice(idx, 1);
                });
            } else if (action.type === 'reorder') {
                // 恢复分类顺序
                const prev = action.prev || [];
                prev.forEach(p => {
                    const c = categories.value.find(cat => cat.id === p.id);
                    if (c) {
                        c.parentId = p.parentId;
                        c.order = p.order;
                    }
                });
                // 依据 order 排序
                categories.value.sort((a, b) => (a.order || 0) - (b.order || 0));
            } else if (action.type === 'delete-category') {
                // 恢复被删除前的整个 categories 和 bookmarks 状态
                const prev = action.prev || null;
                if (prev) {
                    categories.value = prev.categories;
                    bookmarks.value = prev.bookmarks;
                }
            }
            saveData();
            undoToast.value = false;
            if (undoTimer) clearTimeout(undoTimer);
        };

        // wrapper：在分类节点上放置时，先尝试分类重排（如果是分类拖拽），否则处理书签/外部链接放置
        const handleCategoryDropOrReorder = (categoryId, event) => {
            // 检查 dataTransfer 是否为分类重排
            try {
                const data = event.dataTransfer.getData('text/plain');
                if (data && data.startsWith('category:')) {
                    handleCategoryReorderDrop(categoryId, event);
                    return;
                }
            } catch (e) {}
            // 否则当作书签或外部链接放置
            handleCategoryDrop(categoryId, event);
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