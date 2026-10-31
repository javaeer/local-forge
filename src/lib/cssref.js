// ===================== CSS 属性速查数据 + 可视化生成器 (移植自 css.html) =====================
// 纯数据 + 纯函数，零依赖。getVisual / hlCSS 仅输出内联 HTML 字符串，由视图层用 v-html 渲染。
// 对应的 vp-* / cblk 样式与 @keyframes 由 CssReference.vue 以非 scoped 样式注入，确保 v-html 内容被样式化。

// 分类顺序（驱动视图渲染顺序）
export const CATEGORY_ORDER = [
  'selector', 'layout', 'box', 'visual', 'text', 'transform', 'motion',
]

// ===== DATA: prop -> [desc, code] =====
export const D = {
selector: {
  label:'选择器 · Selectors', color:'#fb923c',
  props: {
    '*': ['通配选择器，匹配所有元素','* { margin: 0; padding: 0; box-sizing: border-box; }'],
    'element': ['元素/标签选择器','p { line-height: 1.6; }\nh1 { font-weight: 700; }\ndiv { display: block; }'],
    '.class': ['类选择器，匹配 class 属性','.card { border-radius: 12px; }\n.active { color: #f97316; }\n.font-bold { font-weight: 700; }'],
    '#id': ['ID 选择器，匹配 id 属性（唯一）','#header { position: sticky; top: 0; }\n#app { max-width: 1200px; }'],
    '[attr]': ['属性选择器，匹配拥有某属性','input[required] { border-color: red; }\na[href^="https"] { color: green; }\nimg[alt] { border: 1px solid; }'],
    '[attr=value]': ['属性值精确匹配','input[type="text"] { padding: 8px; }\ninput[type="checkbox"] { width: 18px; }\na[target="_blank"] { /* 新窗口链接 */ }'],
    '[attr^=value]': ['属性值以指定值开头','a[href^="https"] { color: green; }\n[class^="col-"] { float: left; }'],
    '[attr$=value]': ['属性值以指定值结尾','a[href$=".pdf"] { background: url(pdf-icon.svg); }\nimg[src$=".svg"] { width: 100%; }'],
    '[attr*=value]': ['属性值包含指定值','a[href*="example"] { color: orange; }\n[class*="btn-"] { cursor: pointer; }'],
    'A B': ['后代选择器，A 内所有 B（含深层）','.card p { margin-bottom: 8px; }\nnav a { text-decoration: none; }'],
    'A > B': ['子选择器，A 的直接子元素 B','.list > li { border-bottom: 1px solid; }\nnav > ul { display: flex; }'],
    'A + B': ['相邻兄弟选择器，A 紧邻的下一个 B','h1 + p { font-size: 1.2em; }\n.label + input { margin-left: 8px; }'],
    'A ~ B': ['通用兄弟选择器，A 后面所有兄弟 B','h1 ~ p { color: #666; }\n.active ~ li { opacity: 0.5; }'],
    ':hover': ['鼠标悬停时','a:hover { color: #f97316; }\n.btn:hover { background: #ea580c; }'],
    ':active': ['鼠标按下激活时','.btn:active { transform: scale(0.97); }'],
    ':focus': ['获得焦点时','input:focus { border-color: #818cf8; outline: none; }'],
    ':focus-within': ['自身或子元素获得焦点时','.form:focus-within { border-color: #818cf8; }'],
    ':focus-visible': ['键盘聚焦时（区别于鼠标聚焦）','button:focus-visible { outline: 2px solid #818cf8; }'],
    ':first-child': ['第一个子元素','li:first-child { border-radius: 8px 8px 0 0; }'],
    ':last-child': ['最后一个子元素','li:last-child { border-bottom: none; }'],
    ':nth-child()': ['第 n 个子元素','li:nth-child(odd) { background: #f4f4f5; }\ntr:nth-child(2n) { background: #fafafa; }\np:nth-child(3) { color: red; }'],
    ':nth-last-child()': ['倒数第 n 个子元素','li:nth-last-child(2) { margin-bottom: 0; }'],
    ':only-child': ['唯一的子元素','p:only-child { text-align: center; }'],
    ':first-of-type': ['同类型第一个','p:first-of-type { font-size: 1.2em; }'],
    ':last-of-type': ['同类型最后一个','p:last-of-type { margin-bottom: 0; }'],
    ':nth-of-type()': ['同类型第 n 个','article:nth-of-type(even) { background: #fafafa; }'],
    ':nth-last-of-type()': ['同类型倒数第 n 个','span:nth-last-of-type(1) { color: red; }'],
    ':only-of-type': ['同类型唯一一个','img:only-of-type { float: right; }'],
    ':not()': ['不匹配指定选择器','li:not(:last-child) { border-bottom: 1px solid; }\ninput:not(:disabled) { opacity: 1; }'],
    ':is()': ['匹配列表中任一选择器（优先级取最高）',':is(h1, h2, h3):hover { color: #f97316; }\n:is(.btn, .link):focus { outline: 2px solid; }'],
    ':where()': ['同 :is() 但优先级始终为 0',':where(.dark, .light) h1 { font-weight: 700; }'],
    ':has()': ['父选择器——包含匹配子元素时','.card:has(img) { grid-column: span 2; }\nform:has(:invalid) { border-color: red; }'],
    ':checked': ['选中的表单元素','input:checked + label { color: #f97316; }'],
    ':disabled': ['禁用的表单元素','input:disabled { opacity: 0.5; cursor: not-allowed; }'],
    ':enabled': ['启用的表单元素','input:enabled { cursor: text; }'],
    ':read-only': ['只读表单元素','input:read-only { background: #f4f4f5; }'],
    ':required': ['必填表单元素','input:required { border-left: 3px solid red; }'],
    ':valid': ['验证通过的表单元素','input:valid { border-color: #34d399; }'],
    ':invalid': ['验证未通过的表单元素','input:invalid { border-color: #ef4444; }'],
    ':empty': ['没有子元素的元素','p:empty { display: none; }\ndiv:empty::after { content: "暂无内容"; }'],
    ':root': ['文档根元素（<html>）',':root { --primary: #f97316; --bg: #09090b; }'],
    '::before': ['在元素内容前插入伪元素','.quote::before { content: "❝"; font-size: 2em; }'],
    '::after': ['在元素内容后插入伪元素','.link::after { content: " →"; }\n.clearfix::after { content: ""; display: table; clear: both; }'],
    '::first-line': ['首行样式','p::first-line { font-weight: 700; color: #f97316; }'],
    '::first-letter': ['首字母样式','p::first-letter { font-size: 3em; float: left; }'],
    '::selection': ['用户选中文字的样式','::selection { background: #f97316; color: #fff; }'],
    '::placeholder': ['输入框占位符样式','input::placeholder { color: #71717a; font-style: italic; }'],
    '::marker': ['列表项标记样式','li::marker { color: #f97316; font-size: 1.2em; }'],
  }
},
layout: {
  label:'布局 · Layout', color:'#818cf8',
  props: {
    'display': ['设置元素显示类型','display: flex;\ndisplay: grid;\ndisplay: block;\ndisplay: inline-block;\ndisplay: none;\ndisplay: inline;\ndisplay: table;'],
    'position': ['定位方式','position: relative;\nposition: absolute;\nposition: fixed;\nposition: sticky;\nposition: static;'],
    'top': ['上偏移量','top: 10px; top: 50%; top: -20px;'],
    'right': ['右偏移量','right: 0; right: 20px; right: 10%;'],
    'bottom': ['下偏移量','bottom: 0; bottom: 16px; bottom: 50%;'],
    'left': ['左偏移量','left: 0; left: 50%; left: -10px;'],
    'inset': ['top/right/bottom/left 简写','inset: 0;\ninset: 10px 20px;\ninset: 10px 20px 30px 40px;'],
    'z-index': ['层叠顺序','z-index: 100;\nz-index: -1;\nz-index: auto;'],
    'float': ['浮动','float: left;\nfloat: right;\nfloat: none;'],
    'clear': ['清除浮动','clear: both;\nclear: left;\nclear: none;'],
    'flex': ['flex-grow/shrink/basis 简写','flex: 1;           /* 放大填满 */\nflex: 0 1 auto;    /* 不放大可缩小 */\nflex: 0 0 200px;   /* 固定宽度 */'],
    'flex-direction': ['主轴方向','flex-direction: row;            /* 水平 */\nflex-direction: row-reverse;\nflex-direction: column;          /* 垂直 */\nflex-direction: column-reverse;'],
    'flex-wrap': ['是否换行','flex-wrap: nowrap;    /* 不换行 */\nflex-wrap: wrap;       /* 换行 */\nflex-wrap: wrap-reverse;'],
    'flex-flow': ['flex-direction + flex-wrap','flex-flow: row wrap;\nflex-flow: column nowrap;'],
    'flex-grow': ['放大比例，默认 0','flex-grow: 1;  /* 等分剩余 */\nflex-grow: 2;  /* 占2份 */'],
    'flex-shrink': ['缩小比例，默认 1','flex-shrink: 1;  /* 可缩小 */\nflex-shrink: 0;  /* 不缩小 */'],
    'flex-basis': ['初始主轴尺寸','flex-basis: 200px;\nflex-basis: 50%;\nflex-basis: auto;'],
    'justify-content': ['主轴对齐','justify-content: flex-start;\njustify-content: center;\njustify-content: flex-end;\njustify-content: space-between;\njustify-content: space-around;\njustify-content: space-evenly;'],
    'align-items': ['交叉轴对齐','align-items: stretch;     /* 默认 */\nalign-items: flex-start;\nalign-items: center;\nalign-items: flex-end;\nalign-items: baseline;'],
    'align-content': ['多行交叉轴对齐','align-content: flex-start;\nalign-content: center;\nalign-content: space-between;\nalign-content: stretch;'],
    'align-self': ['单个项目交叉轴对齐','align-self: flex-end;\nalign-self: center;\nalign-self: stretch;'],
    'justify-items': ['Grid 子项主轴对齐','justify-items: start;\njustify-items: center;\njustify-items: stretch;'],
    'justify-self': ['单个 Grid 子项主轴对齐','justify-self: start;\njustify-self: center;'],
    'order': ['排列顺序，默认 0','order: -1;  /* 最前 */\norder: 5;   /* 靠后 */'],
    'gap': ['行列间距简写','gap: 16px;\ngap: 8px 16px;  /* 行 列 */'],
    'row-gap': ['行间距','row-gap: 12px;'],
    'column-gap': ['列间距','column-gap: 24px;'],
    'grid': ['Grid 简写','grid: auto-flow dense;\ngrid: repeat(3, 1fr) / repeat(2, 200px);'],
    'grid-template-columns': ['定义列轨道','grid-template-columns: repeat(3, 1fr);\ngrid-template-columns: 200px 1fr 2fr;\ngrid-template-columns: repeat(auto-fill, minmax(250px, 1fr));'],
    'grid-template-rows': ['定义行轨道','grid-template-rows: 100px auto 100px;\ngrid-template-rows: repeat(3, 1fr);'],
    'grid-template-areas': ['命名区域布局','grid-template-areas:\n  "header header"\n  "sidebar main"\n  "footer footer";'],
    'grid-auto-flow': ['自动放置算法','grid-auto-flow: row;      /* 逐行 */\ngrid-auto-flow: column;   /* 逐列 */\ngrid-auto-flow: dense;    /* 紧凑 */'],
    'grid-auto-rows': ['隐式行尺寸','grid-auto-rows: minmax(100px, auto);\ngrid-auto-rows: 150px;'],
    'grid-auto-columns': ['隐式列尺寸','grid-auto-columns: 100px;\ngrid-auto-columns: minmax(80px, 1fr);'],
    'grid-column': ['列起止简写','grid-column: 1 / 3;     /* 跨2列 */\ngrid-column: span 2;\ngrid-column: 1 / -1;    /* 全宽 */'],
    'grid-row': ['行起止简写','grid-row: 1 / 2;\ngrid-row: span 3;'],
    'grid-area': ['行列起止简写/命名区域','grid-area: header;\ngrid-area: 1 / 1 / 3 / 3;'],
    'place-items': ['align-items + justify-items','place-items: center;\nplace-items: start center;'],
    'place-content': ['align-content + justify-content','place-content: center;\nplace-content: center space-between;'],
    'place-self': ['align-self + justify-self','place-self: center;\nplace-self: end start;'],
    'columns': ['多列简写','columns: 3;\ncolumns: 200px 3;'],
    'column-count': ['多列列数','column-count: 3;\ncolumn-count: auto;'],
    'column-width': ['多列列宽','column-width: 200px;'],
    'column-rule': ['列间分割线','column-rule: 1px solid #e0e0e0;'],
    'column-span': ['跨列','column-span: all;\ncolumn-span: none;'],
    'contain': ['限制渲染范围优化性能','contain: layout paint;\ncontain: strict;\ncontain: content;'],
    'container': ['容器查询简写','container: sidebar / inline-size;'],
    'container-type': ['容器查询类型','container-type: inline-size;\ncontainer-type: size;'],
    'container-name': ['容器查询名称','container-name: sidebar;'],
  }
},
box: {
  label:'盒模型 · Box Model', color:'#34d399',
  props: {
    'width': ['元素宽度','width: 320px;\nwidth: 100%;\nwidth: max-content;\nwidth: fit-content;'],
    'height': ['元素高度','height: 100vh;\nheight: auto;\nheight: 500px;'],
    'min-width': ['最小宽度','min-width: 200px;\nmin-width: 0;'],
    'max-width': ['最大宽度','max-width: 1200px;\nmax-width: 100%;'],
    'min-height': ['最小高度','min-height: 400px;\nmin-height: 100vh;'],
    'max-height': ['最大高度','max-height: 80vh;\nmax-height: 600px;'],
    'inline-size': ['逻辑宽度','inline-size: 300px;\ninline-size: 100%;'],
    'block-size': ['逻辑高度','block-size: 200px;\nblock-size: auto;'],
    'margin': ['外边距简写','margin: 16px;\nmargin: 8px 16px;\nmargin: 8px 16px 24px 32px;'],
    'margin-top': ['上外边距','margin-top: 10px;\nmargin-top: auto;'],
    'margin-right': ['右外边距','margin-right: 20px;'],
    'margin-bottom': ['下外边距','margin-bottom: 10px;'],
    'margin-left': ['左外边距','margin-left: 20px;\nmargin-left: auto;'],
    'margin-inline': ['逻辑行向外边距','margin-inline: 16px;\nmargin-inline: 8px 16px;'],
    'margin-block': ['逻辑块向外边距','margin-block: 12px;'],
    'padding': ['内边距简写','padding: 24px;\npadding: 8px 16px;\npadding: 8px 16px 8px 16px;'],
    'padding-top': ['上内边距','padding-top: 12px;'],
    'padding-right': ['右内边距','padding-right: 16px;'],
    'padding-bottom': ['下内边距','padding-bottom: 12px;'],
    'padding-left': ['左内边距','padding-left: 16px;'],
    'padding-inline': ['逻辑行向内边距','padding-inline: 16px;'],
    'padding-block': ['逻辑块向内边距','padding-block: 12px;'],
    'border': ['边框简写','border: 1px solid #e0e0e0;\nborder: 2px dashed #999;\nborder: none;'],
    'border-width': ['边框宽度','border-width: 2px;\nborder-width: 1px 2px;'],
    'border-top': ['上边框','border-top: 2px solid #000;'],
    'border-right': ['右边框','border-right: 1px dashed #ccc;'],
    'border-bottom': ['下边框','border-bottom: 3px double #333;'],
    'border-left': ['左边框','border-left: 4px dotted #999;'],
    'border-radius': ['圆角简写','border-radius: 12px;\nborder-radius: 50%;  /* 圆形 */\nborder-radius: 8px 8px 0 0;'],
    'border-top-left-radius': ['左上圆角','border-top-left-radius: 8px;'],
    'border-top-right-radius': ['右上圆角','border-top-right-radius: 8px;'],
    'border-bottom-left-radius': ['左下圆角','border-bottom-left-radius: 0;'],
    'border-bottom-right-radius': ['右下圆角','border-bottom-right-radius: 0;'],
    'box-sizing': ['盒模型计算方式','box-sizing: border-box;   /* 推荐 */\nbox-sizing: content-box;   /* 默认 */'],
    'overflow': ['溢出处理','overflow: hidden;\noverflow: auto;\noverflow: scroll;\noverflow: clip;'],
    'overflow-x': ['水平溢出','overflow-x: auto;\noverflow-x: hidden;'],
    'overflow-y': ['垂直溢出','overflow-y: auto;\noverflow-y: scroll;'],
    'aspect-ratio': ['宽高比','aspect-ratio: 16 / 9;\naspect-ratio: 1;       /* 正方形 */'],
    'outline': ['轮廓简写（不影响布局）','outline: 2px solid blue;\noutline: none;'],
    'outline-offset': ['轮廓偏移','outline-offset: 4px;\noutline-offset: -2px;'],
    'visibility': ['可见性','visibility: hidden;    /* 隐藏但占位 */\nvisibility: visible;\nvisibility: collapse;'],
    'resize': ['用户可调整尺寸','resize: both;\nresize: vertical;\nresize: none;'],
    'box-decoration-break': ['分段装饰','box-decoration-break: clone;\nbox-decoration-break: slice;'],
    'overscroll-behavior': ['过度滚动行为','overscroll-behavior: contain;\noverscroll-behavior: none;'],
  }
},
visual: {
  label:'视觉外观 · Visual', color:'#f472b6',
  props: {
    'background': ['背景简写','background: #fff;\nbackground: url(bg.jpg) no-repeat center / cover;\nbackground: linear-gradient(135deg, #667eea, #764ba2);'],
    'background-color': ['背景颜色','background-color: #ffffff;\nbackground-color: rgba(0,0,0,0.5);'],
    'background-image': ['背景图片','background-image: url("bg.jpg");\nbackground-image: linear-gradient(to right, #fff, #000);'],
    'background-size': ['背景尺寸','background-size: cover;     /* 铺满 */\nbackground-size: contain;   /* 完整显示 */'],
    'background-position': ['背景位置','background-position: center;\nbackground-position: top right;'],
    'background-repeat': ['背景重复','background-repeat: no-repeat;\nbackground-repeat: repeat-x;'],
    'background-attachment': ['背景滚动方式','background-attachment: fixed;\nbackground-attachment: scroll;'],
    'background-clip': ['背景裁剪区域','background-clip: border-box;\nbackground-clip: content-box;\nbackground-clip: text;  /* 文字遮罩 */'],
    'background-origin': ['背景定位区域','background-origin: padding-box;\nbackground-origin: content-box;'],
    'background-blend-mode': ['背景混合模式','background-blend-mode: multiply;\nbackground-blend-mode: screen;\nbackground-blend-mode: overlay;'],
    'color': ['文本颜色','color: #333;\ncolor: rgb(255,100,50);\ncolor: hsl(24, 95%, 53%);'],
    'box-shadow': ['盒子阴影','box-shadow: 0 4px 12px rgba(0,0,0,0.08);\nbox-shadow: 0 0 0 3px #f97316;  /* 模拟边框 */\nbox-shadow: inset 0 2px 4px rgba(0,0,0,0.1);'],
    'text-shadow': ['文字阴影','text-shadow: 1px 1px 2px rgba(0,0,0,0.3);\ntext-shadow: 0 0 10px #f97316;  /* 发光 */'],
    'opacity': ['不透明度 0~1','opacity: 1;     /* 不透明 */\nopacity: 0.5;   /* 半透明 */\nopacity: 0;     /* 全透明 */'],
    'filter': ['滤镜','filter: blur(4px);\nfilter: brightness(1.2);\nfilter: grayscale(100%);  /* 灰度 */\nfilter: drop-shadow(2px 2px 4px rgba(0,0,0,0.3));'],
    'backdrop-filter': ['背景滤镜','backdrop-filter: blur(10px);\nbackdrop-filter: blur(10px) saturate(180%);'],
    'border-color': ['边框颜色','border-color: #e0e0e0;\nborder-color: #000 transparent;'],
    'border-style': ['边框样式','border-style: solid;\nborder-style: dashed;\nborder-style: double;\nborder-style: dotted;'],
    'border-image': ['边框图像','border-image: url(border.png) 30 round;\nborder-image: linear-gradient(#f97316, #818cf8) 1;'],
    'mix-blend-mode': ['元素混合模式','mix-blend-mode: multiply;\nmix-blend-mode: screen;\nmix-blend-mode: difference;'],
    'clip-path': ['裁剪路径','clip-path: circle(50%);  /* 圆形 */\nclip-path: polygon(50% 0%, 100% 100%, 0% 100%);  /* 三角 */\nclip-path: inset(10px round 8px);'],
    'mask': ['遮罩简写','mask: url(mask.svg);\nmask: linear-gradient(to bottom, black, transparent);'],
    'cursor': ['鼠标指针','cursor: pointer;\ncursor: not-allowed;\ncursor: grab;\ncursor: zoom-in;'],
    'pointer-events': ['指针事件','pointer-events: auto;\npointer-events: none;  /* 穿透 */'],
    'user-select': ['用户选择文本','user-select: auto;\nuser-select: none;    /* 禁止选择 */\nuser-select: all;     /* 一键全选 */'],
    'accent-color': ['表单控件强调色','accent-color: #f97316;'],
    'caret-color': ['文本光标颜色','caret-color: #f97316;\ncaret-color: transparent;'],
    'object-fit': ['替换元素填充','object-fit: cover;    /* 裁剪铺满 */\nobject-fit: contain;  /* 完整显示 */\nobject-fit: fill;     /* 拉伸 */'],
    'object-position': ['替换元素定位','object-position: center;\nobject-position: top left;'],
    'isolation': ['隔离层叠上下文','isolation: isolate;\nisolation: auto;'],
    'list-style': ['列表样式简写','list-style: disc inside;\nlist-style: none;'],
    'list-style-type': ['列表标记类型','list-style-type: disc;\nlist-style-type: decimal;\nlist-style-type: none;'],
    'list-style-position': ['列表标记位置','list-style-position: inside;\nlist-style-position: outside;'],
    'content': ['伪元素内容','content: "→";\ncontent: attr(href);\ncontent: counter(section);'],
    'appearance': ['控件外观','appearance: none;   /* 去原生样式 */\nappearance: auto;'],
    'image-rendering': ['图像缩放算法','image-rendering: auto;\nimage-rendering: crisp-edges;\nimage-rendering: pixelated;'],
  }
},
text: {
  label:'字体与文本 · Typography', color:'#fbbf24',
  props: {
    'font': ['字体简写','font: italic bold 16px/1.5 "Inter", sans-serif;\nfont: 1rem/1.6 system-ui;'],
    'font-family': ['字体族','font-family: "Inter", system-ui, sans-serif;\nfont-family: "Georgia", serif;\nfont-family: "Fira Code", monospace;'],
    'font-size': ['字号','font-size: 16px;\nfont-size: 1rem;\nfont-size: clamp(14px, 2vw, 18px);'],
    'font-weight': ['字重','font-weight: normal;  /* 400 */\nfont-weight: bold;     /* 700 */\nfont-weight: 300;\nfont-weight: 900;'],
    'font-style': ['字体样式','font-style: normal;\nfont-style: italic;\nfont-style: oblique;'],
    'font-variant': ['字体变体','font-variant: normal;\nfont-variant: small-caps;'],
    'line-height': ['行高','line-height: 1.5;    /* 推荐无单位 */\nline-height: 24px;\nline-height: normal;'],
    'letter-spacing': ['字间距','letter-spacing: 0.05em;\nletter-spacing: -0.02em;'],
    'word-spacing': ['词间距','word-spacing: 0.1em;\nword-spacing: normal;'],
    'text-align': ['文本对齐','text-align: left;\ntext-align: center;\ntext-align: right;\ntext-align: justify;'],
    'text-align-last': ['最后一行对齐','text-align-last: left;\ntext-align-last: center;'],
    'text-decoration': ['文本装饰简写','text-decoration: underline;\ntext-decoration: line-through;\ntext-decoration: underline wavy #f97316;\ntext-decoration: none;'],
    'text-decoration-line': ['装饰线类型','text-decoration-line: underline;\ntext-decoration-line: overline;\ntext-decoration-line: line-through;'],
    'text-decoration-color': ['装饰线颜色','text-decoration-color: #f97316;'],
    'text-decoration-style': ['装饰线样式','text-decoration-style: solid;\ntext-decoration-style: dashed;\ntext-decoration-style: wavy;'],
    'text-decoration-thickness': ['装饰线粗细','text-decoration-thickness: 2px;\ntext-decoration-thickness: auto;'],
    'text-transform': ['文本转换','text-transform: uppercase;   /* 全大写 */\ntext-transform: lowercase;   /* 全小写 */\ntext-transform: capitalize;  /* 首字母大写 */'],
    'text-indent': ['首行缩进','text-indent: 2em;\ntext-indent: 32px;'],
    'text-overflow': ['文本溢出标记','text-overflow: ellipsis;  /* 省略号 */\ntext-overflow: clip;       /* 裁剪 */'],
    'text-shadow': ['文字阴影','text-shadow: 1px 1px 2px rgba(0,0,0,0.3);\ntext-shadow: 0 0 10px #f97316;'],
    'white-space': ['空白处理','white-space: normal;\nwhite-space: nowrap;     /* 不换行 */\nwhite-space: pre;        /* 保留空白 */\nwhite-space: pre-wrap;   /* 保留+换行 */'],
    'word-break': ['断词规则','word-break: normal;\nword-break: break-all;   /* 任意断词 */\nword-break: keep-all;    /* CJK不断词 */'],
    'overflow-wrap': ['溢出换行','overflow-wrap: normal;\noverflow-wrap: break-word;\noverflow-wrap: anywhere;'],
    'vertical-align': ['垂直对齐','vertical-align: middle;\nvertical-align: top;\nvertical-align: baseline;\nvertical-align: sub;'],
    'direction': ['文本方向','direction: ltr;\ndirection: rtl;'],
    'writing-mode': ['书写模式','writing-mode: horizontal-tb;  /* 默认 */\nwriting-mode: vertical-rl;     /* 竖排 */\nwriting-mode: vertical-lr;'],
    'text-orientation': ['竖排字符方向','text-orientation: mixed;\ntext-orientation: upright;\ntext-orientation: sideways;'],
    'tab-size': ['Tab 字符宽度','tab-size: 4;\ntab-size: 2;'],
    'hyphens': ['连字符','hyphens: none;\nhyphens: manual;\nhyphens: auto;'],
    'line-break': ['行断规则','line-break: auto;\nline-break: strict;\nline-break: anywhere;'],
    'text-justify': ['两端对齐方式','text-justify: auto;\ntext-justify: inter-word;\ntext-justify: inter-character;'],
  }
},
transform: {
  label:'变换 · Transform', color:'#a78bfa',
  props: {
    'transform': ['变换简写','transform: translateX(20px);\ntransform: rotate(45deg);\ntransform: scale(1.5);\ntransform: skew(10deg, 5deg);\ntransform: translate(10px, 20px) rotate(45deg);'],
    'translate': ['独立位移','translate: 20px;\ntranslate: 10px 20px;\ntranslate: 0 0 50px;'],
    'rotate': ['独立旋转','rotate: 45deg;\nrotate: 0.5turn;'],
    'scale': ['独立缩放','scale: 1.5;\nscale: 2 0.5;'],
    'skew': ['独立斜切','skew: 10deg;\nskew: 10deg 5deg;'],
    'translateX': ['X 轴位移','transform: translateX(50px);\ntransform: translateX(-100%);'],
    'translateY': ['Y 轴位移','transform: translateY(-10px);\ntransform: translateY(50%);'],
    'translateZ': ['Z 轴位移','transform: translateZ(50px);'],
    'translate3d': ['3D 位移','transform: translate3d(10px, 20px, 30px);'],
    'rotateX': ['绕 X 轴旋转','transform: rotateX(45deg);'],
    'rotateY': ['绕 Y 轴旋转','transform: rotateY(30deg);'],
    'rotateZ': ['绕 Z 轴旋转','transform: rotateZ(45deg);'],
    'rotate3d': ['绕任意轴旋转','transform: rotate3d(1, 1, 0, 60deg);'],
    'scaleX': ['X 轴缩放','transform: scaleX(2);'],
    'scaleY': ['Y 轴缩放','transform: scaleY(1.5);'],
    'scaleZ': ['Z 轴缩放','transform: scaleZ(2);'],
    'scale3d': ['3D 缩放','transform: scale3d(1.5, 1, 1);'],
    'skewX': ['X 轴斜切','transform: skewX(15deg);'],
    'skewY': ['Y 轴斜切','transform: skewY(5deg);'],
    'matrix': ['2D 变换矩阵','transform: matrix(1, 0, 0, 1, 10, 20);'],
    'matrix3d': ['3D 变换矩阵 4×4','transform: matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 10,20,0,1);'],
    'transform-origin': ['变换原点','transform-origin: center;\ntransform-origin: top left;\ntransform-origin: 50% 50%;'],
    'perspective': ['透视距离','perspective: 800px;\nperspective: none;'],
    'perspective-origin': ['透视消失点','perspective-origin: 50% 50%;\nperspective-origin: left top;'],
    'backface-visibility': ['背面可见性','backface-visibility: hidden;\nbackface-visibility: visible;'],
    'transform-style': ['子元素变换空间','transform-style: flat;\ntransform-style: preserve-3d;'],
  }
},
motion: {
  label:'过渡与动画 · Motion', color:'#22d3ee',
  props: {
    'transition': ['过渡简写','transition: all 0.3s ease;\ntransition: transform 0.3s ease, opacity 0.5s;\ntransition: background 0.2s ease-in-out 0.1s;'],
    'transition-property': ['过渡属性名','transition-property: all;\ntransition-property: transform, opacity;'],
    'transition-duration': ['过渡时长','transition-duration: 0.3s;\ntransition-duration: 300ms;'],
    'transition-timing-function': ['过渡曲线','transition-timing-function: ease;\ntransition-timing-function: linear;\ntransition-timing-function: ease-in-out;\ntransition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);\ntransition-timing-function: steps(4, end);'],
    'transition-delay': ['过渡延迟','transition-delay: 0.1s;\ntransition-delay: -0.5s;  /* 负值立即开始 */'],
    'transition-behavior': ['允许离散属性过渡','transition-behavior: normal;\ntransition-behavior: allow-discrete;  /* 允许 display 过渡 */'],
    'animation': ['动画简写','animation: fadeIn 0.5s ease forwards;\nanimation: slideIn 0.3s ease-out infinite alternate;\nanimation: bounce 1s cubic-bezier(0.36,0.07,0.19,0.97) both;'],
    'animation-name': ['@keyframes 名称','animation-name: fadeIn;\nanimation-name: slideIn, bounce;'],
    'animation-duration': ['动画时长','animation-duration: 0.5s;\nanimation-duration: 2s;'],
    'animation-timing-function': ['动画曲线','animation-timing-function: ease;\nanimation-timing-function: linear;\nanimation-timing-function: steps(4);'],
    'animation-delay': ['动画延迟','animation-delay: 0.2s;\nanimation-delay: -0.5s;'],
    'animation-iteration-count': ['播放次数','animation-iteration-count: 1;\nanimation-iteration-count: infinite;\nanimation-iteration-count: 3;'],
    'animation-direction': ['播放方向','animation-direction: normal;\nanimation-direction: reverse;\nanimation-direction: alternate;\nanimation-direction: alternate-reverse;'],
    'animation-fill-mode': ['填充模式','animation-fill-mode: none;\nanimation-fill-mode: forwards;    /* 停在终态 */\nanimation-fill-mode: backwards;\nanimation-fill-mode: both;'],
    'animation-play-state': ['播放状态','animation-play-state: running;\nanimation-play-state: paused;'],
    'animation-timeline': ['动画时间线','animation-timeline: auto;\nanimation-timeline: scroll();  /* 滚动驱动 */\nanimation-timeline: view();   /* 视图驱动 */'],
    'animation-range': ['动画范围','animation-range: normal;\nanimation-range: entry 0% cover 50%;'],
    '@keyframes': ['关键帧定义','@keyframes fadeIn {\n  from { opacity: 0; }\n  to   { opacity: 1; }\n}\n\n@keyframes bounce {\n  0%, 100% { transform: translateY(0); }\n  50%      { transform: translateY(-20px); }\n}'],
    'will-change': ['性能提示','will-change: transform;\nwill-change: opacity;\nwill-change: auto;'],
    'scroll-behavior': ['滚动行为','scroll-behavior: smooth;\nscroll-behavior: auto;'],
    'scroll-timeline': ['滚动时间线简写','scroll-timeline: --scroll-tl;\nscroll-timeline: --tl block;'],
    'scroll-timeline-name': ['滚动时间线名称','scroll-timeline-name: --my-tl;'],
    'scroll-timeline-axis': ['滚动时间线轴','scroll-timeline-axis: block;\nscroll-timeline-axis: y;'],
    'view-timeline': ['视图时间线简写','view-timeline: --view-tl;'],
    'view-timeline-name': ['视图时间线名称','view-timeline-name: --view-tl;'],
    'view-timeline-inset': ['视图时间线内边距','view-timeline-inset: 0;\nview-timeline-inset: 100px;'],
  }
}
};

// ===== VISUAL PREVIEW GENERATOR =====
export function getVisual(prop, catKey) {
  const uid = 'v' + Math.random().toString(36).slice(2,8);
  const box = (cls='',s='') => `<div class="vp-box ${cls}" style="${s}">A</div><div class="vp-box g ${cls}" style="${s}">B</div><div class="vp-box p ${cls}" style="${s}">C</div>`;
  const txt = (s='') => `<div class="vp-txt" style="${s}">The quick brown fox jumps over the lazy dog. 敏捷的棕色狐狸跳过懒狗。</div>`;

  // SELECTOR visuals
  if (catKey === 'selector') {
    if (prop === '*') return `<div class="vp-wrap" style="flex-wrap:wrap"><div class="vp-box">✶</div><div class="vp-box g">✶</div><div class="vp-box p">✶</div><div class="vp-box y">✶</div><div class="vp-box o">✶</div></div>`;
    if (prop === 'element') return `<div class="vp-wrap"><div style="padding:4px 10px;background:rgba(249,115,22,0.15);border:1px dashed #fb923c;border-radius:4px;color:#fb923c;font-size:10px">&lt;p&gt;</div><div class="vp-arrow">→</div><div style="padding:4px 10px;background:rgba(129,140,248,0.15);border:1px solid #818cf8;border-radius:4px;color:#818cf8;font-size:10px">匹配</div></div>`;
    if (prop === '.class') return `<div class="vp-wrap"><div style="padding:4px 10px;background:rgba(249,115,22,0.15);border:1px dashed #fb923c;border-radius:4px;color:#fb923c;font-size:10px">.card</div><div class="vp-arrow">→</div><div style="padding:4px 10px;background:rgba(52,211,153,0.15);border:1px solid #34d399;border-radius:4px;color:#34d399;font-size:10px">class="card"</div></div>`;
    if (prop === '#id') return `<div class="vp-wrap"><div style="padding:4px 10px;background:rgba(249,115,22,0.15);border:1px dashed #fb923c;border-radius:4px;color:#fb923c;font-size:10px">#header</div><div class="vp-arrow">→</div><div style="padding:4px 10px;background:rgba(129,140,248,0.15);border:1px solid #818cf8;border-radius:4px;color:#818cf8;font-size:10px">id="header"</div></div>`;
    if (prop.startsWith('[attr')) return `<div class="vp-wrap" style="flex-direction:column;align-items:flex-start;gap:4px"><div style="padding:3px 8px;background:rgba(249,115,22,0.12);border-radius:3px;font-size:10px;color:#fb923c;font-family:monospace">[type="text"]</div><div style="display:flex;gap:4px"><div style="padding:3px 8px;border:1px solid #34d399;border-radius:3px;font-size:10px;color:#34d399">✓ &lt;input type="text"&gt;</div><div style="padding:3px 8px;border:1px solid #52525b;border-radius:3px;font-size:10px;color:#52525b">✗ &lt;input type="email"&gt;</div></div></div>`;
    if (prop === 'A B') return `<div class="vp-wrap" style="flex-direction:column;gap:2px"><div style="padding:3px 8px;background:rgba(249,115,22,0.12);border-radius:3px;font-size:10px;color:#fb923c;font-family:monospace">.card p</div><div style="border:2px dashed #52525b;border-radius:4px;padding:6px"><div style="font-size:9px;color:#52525b;margin-bottom:2px">.card</div><div style="padding:3px 8px;background:rgba(52,211,153,0.12);border:1px solid #34d399;border-radius:3px;font-size:10px;color:#34d399">✓ p (后代)</div></div></div>`;
    if (prop === 'A > B') return `<div class="vp-wrap" style="flex-direction:column;gap:2px"><div style="padding:3px 8px;background:rgba(249,115,22,0.12);border-radius:3px;font-size:10px;color:#fb923c;font-family:monospace">.list > li</div><div style="border:2px dashed #52525b;border-radius:4px;padding:6px"><div style="font-size:9px;color:#52525b;margin-bottom:2px">.list</div><div style="padding:3px 8px;background:rgba(52,211,153,0.12);border:1px solid #34d399;border-radius:3px;font-size:10px;color:#34d399">✓ 直接子 li</div><div style="margin-left:12px;padding:3px 8px;border:1px solid #52525b;border-radius:3px;font-size:10px;color:#52525b">✗ 嵌套 li</div></div></div>`;
    if (prop === 'A + B') return `<div class="vp-wrap" style="gap:2px"><div style="padding:3px 8px;background:rgba(129,140,248,0.12);border-radius:3px;font-size:10px;color:#818cf8">h1</div><div style="color:#fb923c;font-size:10px">+</div><div style="padding:3px 8px;background:rgba(52,211,153,0.15);border:1px solid #34d399;border-radius:3px;font-size:10px;color:#34d399">✓ 紧邻 p</div><div style="padding:3px 8px;border:1px solid #52525b;border-radius:3px;font-size:10px;color:#52525b">✗ 非紧邻 p</div></div>`;
    if (prop === 'A ~ B') return `<div class="vp-wrap" style="gap:2px"><div style="padding:3px 8px;background:rgba(129,140,248,0.12);border-radius:3px;font-size:10px;color:#818cf8">h1</div><div style="color:#fb923c;font-size:10px">~</div><div style="padding:3px 8px;background:rgba(52,211,153,0.15);border:1px solid #34d399;border-radius:3px;font-size:10px;color:#34d399">✓ p</div><div style="padding:3px 8px;background:rgba(52,211,153,0.15);border:1px solid #34d399;border-radius:3px;font-size:10px;color:#34d399">✓ p</div></div>`;
    if (prop === ':hover') return `<div class="vp-wrap"><div style="padding:8px 16px;background:rgba(129,140,248,0.2);border:2px solid #818cf8;border-radius:6px;font-size:11px;color:#818cf8;cursor:pointer;transition:all .2s" onmouseover="this.style.background='rgba(249,115,22,0.3)';this.style.borderColor='#f97316';this.style.color='#f97316'" onmouseout="this.style.background='rgba(129,140,248,0.2)';this.style.borderColor='#818cf8';this.style.color='#818cf8'">鼠标悬停试试</div></div>`;
    if (prop === ':active') return `<div class="vp-wrap"><div style="padding:8px 16px;background:rgba(129,140,248,0.2);border:2px solid #818cf8;border-radius:6px;font-size:11px;color:#818cf8;cursor:pointer;transition:all .1s" onmousedown="this.style.transform='scale(0.95)';this.style.background='rgba(249,115,22,0.3)'" onmouseup="this.style.transform='scale(1)';this.style.background='rgba(129,140,248,0.2)'">按住试试</div></div>`;
    if (prop === ':focus') return `<div class="vp-wrap"><input style="padding:6px 12px;background:#09090b;border:2px solid #52525b;border-radius:6px;color:#d4d4d8;font-size:12px;outline:none;transition:border-color .2s" placeholder="点击聚焦" onfocus="this.style.borderColor='#818cf8'" onblur="this.style.borderColor='#52525b'"></div>`;
    if (prop === ':checked') return `<div class="vp-wrap" style="gap:12px"><label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#a1a1aa;cursor:pointer"><input type="checkbox" style="accent-color:#f97316;width:16px;height:16px">选项A</label><label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#a1a1aa;cursor:pointer"><input type="checkbox" style="accent-color:#f97316;width:16px;height:16px" checked>选项B ✓</label></div>`;
    if (prop === '::before' || prop === '::after') return `<div class="vp-wrap"><div style="font-size:13px;color:#d4d4d8"><span style="color:#f97316;font-size:16px">❝</span> 这段文字前有伪元素 <span style="color:#f97316">→</span></div></div>`;
    if (prop === '::selection') return `<div class="vp-wrap"><div class="vp-txt" style="font-size:12px">试着选中这段文字 → 可见 ::selection 效果</div></div>`;
    if (prop === '::placeholder') return `<div class="vp-wrap"><input style="padding:8px 12px;background:#09090b;border:1px solid #52525b;border-radius:6px;color:#d4d4d8;font-size:12px;width:200px" placeholder="这是 placeholder 样式"></div>`;
    if (prop === ':nth-child()') return `<div class="vp-wrap" style="gap:3px"><div style="padding:3px 8px;background:rgba(52,211,153,0.2);border:1px solid #34d399;border-radius:3px;font-size:9px;color:#34d399">1 ✓</div><div style="padding:3px 8px;background:rgba(80,80,90,0.2);border:1px solid #3f3f46;border-radius:3px;font-size:9px;color:#71717a">2</div><div style="padding:3px 8px;background:rgba(52,211,153,0.2);border:1px solid #34d399;border-radius:3px;font-size:9px;color:#34d399">3 ✓</div><div style="padding:3px 8px;background:rgba(80,80,90,0.2);border:1px solid #3f3f46;border-radius:3px;font-size:9px;color:#71717a">4</div><div style="font-size:9px;color:#52525b;margin-left:4px">odd 奇数</div></div>`;
    if (prop === ':not()') return `<div class="vp-wrap" style="gap:3px"><div style="padding:3px 8px;background:rgba(80,80,90,0.2);border:1px solid #3f3f46;border-radius:3px;font-size:9px;color:#71717a">.active</div><div style="padding:3px 8px;background:rgba(52,211,153,0.2);border:1px solid #34d399;border-radius:3px;font-size:9px;color:#34d399">✓ :not(.active)</div><div style="padding:3px 8px;background:rgba(52,211,153,0.2);border:1px solid #34d399;border-radius:3px;font-size:9px;color:#34d399">✓ :not(.active)</div></div>`;
    if (prop === ':has()') return `<div class="vp-wrap" style="flex-direction:column;gap:4px"><div style="border:2px solid #34d399;border-radius:4px;padding:4px 8px;font-size:9px;color:#34d399">.card:has(img) ✓<div style="width:20px;height:14px;background:#818cf8;border-radius:2px;margin-top:2px"></div></div><div style="border:1px solid #3f3f46;border-radius:4px;padding:4px 8px;font-size:9px;color:#71717a">.card (无img)</div></div>`;
    if (prop === ':is()' || prop === ':where()') return `<div class="vp-wrap" style="flex-wrap:wrap;gap:3px"><div style="padding:3px 8px;background:rgba(249,115,22,0.12);border-radius:3px;font-size:9px;color:#fb923c;font-family:monospace">:is(h1,h2,h3)</div><div style="padding:3px 8px;background:rgba(52,211,153,0.12);border:1px solid #34d399;border-radius:3px;font-size:9px;color:#34d399">✓ h1</div><div style="padding:3px 8px;background:rgba(52,211,153,0.12);border:1px solid #34d399;border-radius:3px;font-size:9px;color:#34d399">✓ h2</div><div style="padding:3px 8px;background:rgba(52,211,153,0.12);border:1px solid #34d399;border-radius:3px;font-size:9px;color:#34d399">✓ h3</div></div>`;
    if (prop === ':empty') return `<div class="vp-wrap" style="gap:8px"><div style="width:40px;height:24px;border:1px solid #34d399;border-radius:3px;font-size:8px;color:#34d399;display:flex;align-items:center;justify-content:center">✓ 空</div><div style="padding:3px 8px;border:1px solid #3f3f46;border-radius:3px;font-size:9px;color:#71717a">有内容</div></div>`;
    if (prop === ':first-child' || prop === ':last-child') return `<div class="vp-wrap" style="gap:3px;flex-direction:column"><div style="display:flex;gap:3px"><div style="padding:3px 10px;background:rgba(52,211,153,0.2);border:1px solid #34d399;border-radius:3px;font-size:9px;color:#34d399">1 ✓ first</div><div style="padding:3px 10px;border:1px solid #3f3f46;border-radius:3px;font-size:9px;color:#71717a">2</div><div style="padding:3px 10px;background:rgba(249,115,22,0.2);border:1px solid #fb923c;border-radius:3px;font-size:9px;color:#fb923c">3 ✓ last</div></div></div>`;
    if (prop === ':root') return `<div class="vp-wrap"><div style="font-size:10px;color:#fb923c;font-family:monospace;background:rgba(249,115,22,0.1);padding:6px 10px;border-radius:4px">:root { --primary: #f97316; }</div></div>`;
    return `<div class="vp-wrap"><div style="padding:4px 10px;background:rgba(249,115,22,0.12);border:1px dashed #fb923c;border-radius:4px;color:#fb923c;font-size:10px;font-family:monospace">${prop}</div></div>`;
  }

  // LAYOUT visuals
  if (catKey === 'layout') {
    if (prop === 'display') return `<div class="vp-wrap" style="flex-direction:column;gap:6px;align-items:flex-start"><div style="font-size:9px;color:#52525b">display: flex</div><div style="display:flex;gap:4px;width:100%">${box()}</div><div style="font-size:9px;color:#52525b;margin-top:4px">display: block</div><div><div class="vp-box" style="width:100%;margin:2px 0">block 1</div><div class="vp-box g" style="width:70%;margin:2px 0">block 2</div></div></div>`;
    if (prop === 'position') return `<div class="vp-wrap" style="height:80px;position:relative"><div style="position:absolute;top:4px;left:4px;padding:2px 6px;background:rgba(129,140,248,0.3);border:1px solid #818cf8;border-radius:3px;font-size:9px;color:#818cf8">absolute</div><div style="position:absolute;bottom:4px;right:4px;padding:2px 6px;background:rgba(249,115,22,0.3);border:1px solid #fb923c;border-radius:3px;font-size:9px;color:#fb923c">sticky</div></div>`;
    if (prop === 'flex-direction') return `<div class="vp-wrap" style="flex-direction:column;gap:6px;align-items:flex-start"><div style="font-size:9px;color:#52525b">row →</div><div style="display:flex;gap:3px">${box()}</div><div style="font-size:9px;color:#52525b">column ↓</div><div style="display:flex;flex-direction:column;gap:3px">${box()}</div></div>`;
    if (prop === 'flex-wrap') return `<div class="vp-wrap" style="flex-direction:column;gap:6px;align-items:flex-start"><div style="font-size:9px;color:#52525b">nowrap</div><div style="display:flex;gap:3px;flex-wrap:nowrap;max-width:200px;overflow:hidden">${box()}<div class="vp-box y">D</div><div class="vp-box o">E</div></div><div style="font-size:9px;color:#52525b">wrap</div><div style="display:flex;gap:3px;flex-wrap:wrap;max-width:200px">${box()}<div class="vp-box y">D</div><div class="vp-box o">E</div></div></div>`;
    if (prop === 'justify-content') return `<div class="vp-wrap" style="flex-direction:column;gap:6px;align-items:stretch"><div style="font-size:9px;color:#52525b">space-between</div><div style="display:flex;justify-content:space-between">${box()}</div><div style="font-size:9px;color:#52525b">center</div><div style="display:flex;justify-content:center;gap:4px">${box()}</div></div>`;
    if (prop === 'align-items') return `<div class="vp-wrap" style="flex-direction:column;gap:6px;align-items:stretch"><div style="font-size:9px;color:#52525b">center</div><div style="display:flex;align-items:center;gap:4px;height:50px"><div class="vp-box" style="height:20px">A</div><div class="vp-box g" style="height:36px">B</div><div class="vp-box p" style="height:28px">C</div></div></div>`;
    if (prop === 'gap') return `<div class="vp-wrap" style="flex-direction:column;gap:6px;align-items:stretch"><div style="font-size:9px;color:#52525b">gap: 12px</div><div style="display:flex;gap:12px">${box()}</div><div style="font-size:9px;color:#52525b">gap: 4px</div><div style="display:flex;gap:4px">${box()}</div></div>`;
    if (prop.startsWith('grid-template')) return `<div class="vp-wrap" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;width:100%"><div class="vp-box" style="width:auto;height:28px">1</div><div class="vp-box g" style="width:auto;height:28px">2</div><div class="vp-box p" style="width:auto;height:28px">3</div><div class="vp-box y" style="width:auto;height:28px">4</div><div class="vp-box o" style="width:auto;height:28px">5</div><div class="vp-box" style="width:auto;height:28px">6</div></div>`;
    if (prop.startsWith('grid-area') || prop === 'grid-column' || prop === 'grid-row') return `<div class="vp-wrap" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;width:100%"><div class="vp-box" style="grid-column:span 2;width:auto;height:28px;background:rgba(249,115,22,0.3);border-color:#fb923c;color:#fb923c">span 2</div><div class="vp-box g" style="width:auto;height:28px">3</div><div class="vp-box p" style="width:auto;height:28px">4</div><div class="vp-box y" style="width:auto;height:28px">5</div><div class="vp-box o" style="width:auto;height:28px">6</div></div>`;
    if (prop === 'float') return `<div class="vp-wrap" style="align-items:flex-start;height:70px"><div style="float:left;width:36px;height:36px;background:rgba(129,140,248,0.3);border:2px solid #818cf8;border-radius:4px;font-size:9px;color:#818cf8;display:flex;align-items:center;justify-content:center">float</div><div style="font-size:10px;color:#71717a;line-height:1.4">文字环绕浮动元素排列...</div></div>`;
    if (prop === 'z-index') return `<div class="vp-wrap" style="position:relative;height:60px"><div style="position:absolute;left:4px;top:4px;width:40px;height:30px;background:rgba(129,140,248,0.2);border:1px solid #818cf8;border-radius:3px;font-size:8px;color:#818cf8;display:flex;align-items:center;justify-content:center">z:1</div><div style="position:absolute;left:20px;top:14px;width:40px;height:30px;background:rgba(249,115,22,0.3);border:1px solid #fb923c;border-radius:3px;font-size:8px;color:#fb923c;display:flex;align-items:center;justify-content:center;z-index:2">z:2</div></div>`;
    if (prop.startsWith('column')) return `<div class="vp-wrap" style="column-count:3;column-rule:1px solid #3f3f46;gap:8px;text-align:left;font-size:10px;color:#71717a;line-height:1.4">第一列内容第二列内容第三列内容多列布局展示效果</div>`;
  }

  // BOX MODEL visuals
  if (catKey === 'box') {
    if (prop === 'width' || prop === 'height') return `<div class="vp-wrap" style="flex-direction:column;gap:6px"><div style="width:120px;height:40px;background:rgba(129,140,248,0.2);border:2px solid #818cf8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#818cf8">width:120px</div><div style="width:80px;height:40px;background:rgba(52,211,153,0.2);border:2px solid #34d399;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#34d399">width:80px</div></div>`;
    if (prop === 'margin') return `<div class="vp-wrap" style="flex-direction:column;gap:4px;background:rgba(249,115,22,0.08)"><div style="font-size:9px;color:#fb923c;margin-bottom:2px">← margin →</div><div style="background:rgba(52,211,153,0.08);padding:8px;border:1px dashed #34d399"><div style="background:rgba(129,140,248,0.2);border:2px solid #818cf8;padding:8px;text-align:center;font-size:9px;color:#818cf8">content</div></div></div>`;
    if (prop === 'padding') return `<div class="vp-wrap" style="flex-direction:column;gap:4px"><div style="font-size:9px;color:#34d399">← padding →</div><div style="background:rgba(52,211,153,0.15);border:2px solid #34d399;padding:16px;text-align:center"><div style="background:rgba(129,140,248,0.2);border:1px solid #818cf8;padding:4px 8px;font-size:9px;color:#818cf8">content</div></div></div>`;
    if (prop === 'border') return `<div class="vp-wrap" style="gap:8px"><div style="width:50px;height:36px;border:1px solid #818cf8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#818cf8">1px</div><div style="width:50px;height:36px;border:2px dashed #34d399;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#34d399">2px dashed</div><div style="width:50px;height:36px;border:3px dotted #f472b6;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#f472b6">3px dotted</div></div>`;
    if (prop === 'border-radius') return `<div class="vp-wrap" style="gap:8px"><div style="width:44px;height:44px;background:rgba(129,140,248,0.2);border:2px solid #818cf8;border-radius:0;display:flex;align-items:center;justify-content:center;font-size:8px;color:#818cf8">0</div><div style="width:44px;height:44px;background:rgba(52,211,153,0.2);border:2px solid #34d399;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#34d399">8px</div><div style="width:44px;height:44px;background:rgba(244,114,182,0.2);border:2px solid #f472b6;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;color:#f472b6">50%</div></div>`;
    if (prop === 'box-sizing') return `<div class="vp-wrap" style="flex-direction:column;gap:6px"><div style="font-size:9px;color:#818cf8">content-box: 宽度仅含内容</div><div style="width:120px;padding:8px;border:2px solid #818cf8;background:rgba(129,140,248,0.1);font-size:8px;color:#818cf8;text-align:center">content</div><div style="font-size:9px;color:#34d399">border-box: 宽度含边框+内边距 ✓</div><div style="width:120px;padding:8px;border:2px solid #34d399;background:rgba(52,211,153,0.1);box-sizing:border-box;font-size:8px;color:#34d399;text-align:center">content</div></div>`;
    if (prop === 'overflow') return `<div class="vp-wrap" style="gap:8px"><div style="width:80px;height:40px;overflow:hidden;background:rgba(129,140,248,0.1);border:1px solid #818cf8;border-radius:4px;padding:4px;font-size:9px;color:#818cf8">hidden截断内容超出部分</div><div style="width:80px;height:40px;overflow:auto;background:rgba(52,211,153,0.1);border:1px solid #34d399;border-radius:4px;padding:4px;font-size:9px;color:#34d399">auto自动滚动条超出部分</div></div>`;
    if (prop === 'aspect-ratio') return `<div class="vp-wrap" style="gap:8px"><div style="width:60px;aspect-ratio:16/9;background:rgba(129,140,248,0.2);border:2px solid #818cf8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#818cf8">16:9</div><div style="width:44px;aspect-ratio:1;background:rgba(249,115,22,0.2);border:2px solid #fb923c;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fb923c">1:1</div></div>`;
    if (prop === 'outline') return `<div class="vp-wrap" style="gap:8px"><div style="width:60px;height:36px;outline:2px solid #818cf8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#818cf8">outline</div><div style="width:60px;height:36px;outline:2px solid #fb923c;outline-offset:4px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fb923c">offset</div></div>`;
    if (prop === 'visibility') return `<div class="vp-wrap" style="gap:8px"><div style="width:44px;height:36px;background:rgba(129,140,248,0.2);border:2px solid #818cf8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#818cf8">visible</div><div style="width:44px;height:36px;border:2px dashed #52525b;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#52525b;visibility:hidden">hidden</div><div style="width:44px;height:36px;background:rgba(52,211,153,0.2);border:2px solid #34d399;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#34d399">visible</div></div>`;
  }

  // VISUAL visuals
  if (catKey === 'visual') {
    if (prop === 'background' || prop === 'background-color') return `<div class="vp-wrap" style="gap:6px"><div style="width:50px;height:36px;background:#f97316;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff">色值</div><div style="width:50px;height:36px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff">渐变</div><div style="width:50px;height:36px;background:rgba(129,140,248,0.3);border:1px solid #818cf8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#818cf8">rgba</div></div>`;
    if (prop === 'background-image') return `<div class="vp-wrap" style="gap:6px"><div style="width:80px;height:50px;background:linear-gradient(to right,#818cf8,#f97316);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff">linear</div><div style="width:80px;height:50px;background:radial-gradient(circle,#f472b6,#09090b);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#f472b6">radial</div></div>`;
    if (prop === 'box-shadow') return `<div class="vp-wrap" style="gap:10px"><div style="width:50px;height:36px;background:#18181b;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:8px;color:#d4d4d8">阴影</div><div style="width:50px;height:36px;background:#18181b;border-radius:6px;box-shadow:0 0 0 3px #f97316;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fb923c">边框</div><div style="width:50px;height:36px;background:#18181b;border-radius:6px;box-shadow:inset 0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:8px;color:#a1a1aa">内阴影</div></div>`;
    if (prop === 'opacity') return `<div class="vp-wrap" style="gap:8px"><div style="width:44px;height:36px;background:#818cf8;border-radius:4px;opacity:1;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff">1</div><div style="width:44px;height:36px;background:#818cf8;border-radius:4px;opacity:.6;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff">.6</div><div style="width:44px;height:36px;background:#818cf8;border-radius:4px;opacity:.2;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff">.2</div></div>`;
    if (prop === 'filter') return `<div class="vp-wrap" style="gap:6px"><div style="width:50px;height:36px;background:#818cf8;border-radius:4px;filter:none;display:flex;align-items:center;justify-content:center;font-size:7px;color:#fff">原始</div><div style="width:50px;height:36px;background:#818cf8;border-radius:4px;filter:grayscale(100%);display:flex;align-items:center;justify-content:center;font-size:7px;color:#fff">灰度</div><div style="width:50px;height:36px;background:#818cf8;border-radius:4px;filter:blur(2px);display:flex;align-items:center;justify-content:center;font-size:7px;color:#fff">模糊</div><div style="width:50px;height:36px;background:#818cf8;border-radius:4px;filter:brightness(1.5);display:flex;align-items:center;justify-content:center;font-size:7px;color:#fff">亮度</div></div>`;
    if (prop === 'backdrop-filter') return `<div class="vp-wrap" style="position:relative;overflow:hidden"><div style="position:absolute;inset:0;display:flex;gap:4px;padding:4px"><div style="width:30px;height:30px;background:#818cf8;border-radius:50%"></div><div style="width:30px;height:30px;background:#f97316;border-radius:50%"></div></div><div style="position:relative;background:rgba(0,0,0,0.3);backdrop-filter:blur(8px);padding:8px 16px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);font-size:10px;color:#d4d4d8">blur 背景</div></div>`;
    if (prop === 'clip-path') return `<div class="vp-wrap" style="gap:8px"><div style="width:44px;height:44px;background:#818cf8;clip-path:circle(50%);display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff">圆</div><div style="width:44px;height:44px;background:#f97316;clip-path:polygon(50% 0%,100% 100%,0% 100%);display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff">△</div><div style="width:44px;height:44px;background:#34d399;clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%);display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff">⬡</div></div>`;
    if (prop === 'color') return `<div class="vp-wrap" style="gap:6px;flex-direction:column;align-items:flex-start"><div style="font-size:13px;color:#f97316;font-weight:600">橙色文字 #f97316</div><div style="font-size:13px;color:#818cf8;font-weight:600">紫色文字 #818cf8</div><div style="font-size:13px;color:#34d399;font-weight:600">绿色文字 #34d399</div></div>`;
    if (prop === 'cursor') return `<div class="vp-wrap" style="gap:6px"><div style="padding:6px 12px;background:rgba(129,140,248,0.15);border:1px solid #818cf8;border-radius:4px;font-size:9px;color:#818cf8;cursor:pointer">pointer</div><div style="padding:6px 12px;background:rgba(249,115,22,0.15);border:1px solid #fb923c;border-radius:4px;font-size:9px;color:#fb923c;cursor:not-allowed">not-allowed</div><div style="padding:6px 12px;background:rgba(52,211,153,0.15);border:1px solid #34d399;border-radius:4px;font-size:9px;color:#34d399;cursor:grab">grab</div></div>`;
    if (prop === 'object-fit') return `<div class="vp-wrap" style="gap:6px"><div style="width:50px;height:40px;overflow:hidden;border:1px solid #818cf8;border-radius:4px;position:relative"><div style="width:80px;height:60px;background:linear-gradient(#818cf8,#f97316);font-size:7px;color:#fff;display:flex;align-items:center;justify-content:center">cover</div></div><div style="width:50px;height:40px;border:1px solid #34d399;border-radius:4px;position:relative"><div style="width:40px;height:30px;background:linear-gradient(#34d399,#818cf8);margin:auto;font-size:7px;color:#fff;display:flex;align-items:center;justify-content:center;margin-top:5px">contain</div></div></div>`;
    if (prop === 'text-shadow') return `<div class="vp-wrap" style="gap:6px;flex-direction:column;align-items:flex-start"><div style="font-size:16px;color:#d4d4d8;text-shadow:1px 1px 2px rgba(0,0,0,0.5)">普通阴影</div><div style="font-size:16px;color:#f97316;text-shadow:0 0 10px #f97316,0 0 20px #f9731680">发光效果</div></div>`;
  }

  // TEXT visuals
  if (catKey === 'text') {
    if (prop === 'font-size') return `<div class="vp-wrap" style="flex-direction:column;align-items:flex-start;gap:4px"><div style="font-size:20px;color:#818cf8">20px 大号</div><div style="font-size:14px;color:#d4d4d8">14px 正文</div><div style="font-size:10px;color:#71717a">10px 小字</div></div>`;
    if (prop === 'font-weight') return `<div class="vp-wrap" style="flex-direction:column;align-items:flex-start;gap:4px"><div style="font-size:13px;font-weight:300;color:#71717a">300 细体</div><div style="font-size:13px;font-weight:400;color:#a1a1aa">400 常规</div><div style="font-size:13px;font-weight:600;color:#d4d4d8">600 半粗</div><div style="font-size:13px;font-weight:700;color:#f4f4f5">700 粗体</div></div>`;
    if (prop === 'text-align') return `<div class="vp-wrap" style="flex-direction:column;gap:4px;width:100%"><div style="text-align:left;font-size:10px;color:#818cf8;border-bottom:1px solid #27272a;padding:2px 0">← 左对齐 left</div><div style="text-align:center;font-size:10px;color:#34d399;border-bottom:1px solid #27272a;padding:2px 0">居中 center →</div><div style="text-align:right;font-size:10px;color:#f472b6;padding:2px 0">右对齐 right →</div></div>`;
    if (prop === 'text-decoration') return `<div class="vp-wrap" style="flex-direction:column;align-items:flex-start;gap:4px"><div style="font-size:13px;text-decoration:underline;color:#818cf8">下划线 underline</div><div style="font-size:13px;text-decoration:line-through;color:#71717a">删除线 line-through</div><div style="font-size:13px;text-decoration:underline wavy #f97316;color:#fb923c">波浪线 wavy</div><div style="font-size:13px;text-decoration:none;color:#d4d4d8">无装饰 none</div></div>`;
    if (prop === 'text-transform') return `<div class="vp-wrap" style="flex-direction:column;align-items:flex-start;gap:4px"><div style="font-size:12px;text-transform:uppercase;color:#818cf8">uppercase 大写</div><div style="font-size:12px;text-transform:lowercase;color:#34d399">LOWERCASE 小写</div><div style="font-size:12px;text-transform:capitalize;color:#f472b6">capitalize 首字母</div></div>`;
    if (prop === 'line-height') return `<div class="vp-wrap" style="flex-direction:column;gap:6px;width:100%"><div style="font-size:10px;color:#52525b">line-height: 1</div><div style="font-size:11px;line-height:1;color:#71717a;background:rgba(129,140,248,0.05);padding:2px 4px;border-radius:3px">紧凑行距紧凑行距</div><div style="font-size:10px;color:#52525b">line-height: 2</div><div style="font-size:11px;line-height:2;color:#d4d4d8;background:rgba(52,211,153,0.05);padding:2px 4px;border-radius:3px">宽松行距宽松行距</div></div>`;
    if (prop === 'letter-spacing') return `<div class="vp-wrap" style="flex-direction:column;align-items:flex-start;gap:4px"><div style="font-size:13px;letter-spacing:0;color:#71717a">正常间距 normal</div><div style="font-size:13px;letter-spacing:0.15em;color:#818cf8">宽松间距 0.15em</div><div style="font-size:13px;letter-spacing:0.5em;color:#f97316">超宽间距 0.5em</div></div>`;
    if (prop === 'text-overflow') return `<div class="vp-wrap" style="flex-direction:column;gap:4px;width:100%"><div style="font-size:9px;color:#52525b">ellipsis</div><div style="font-size:11px;color:#818cf8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">这是一段很长的文本会被省略号截断显示</div><div style="font-size:9px;color:#52525b">clip</div><div style="font-size:11px;color:#34d399;white-space:nowrap;overflow:hidden;text-overflow:clip;max-width:180px">这是一段很长的文本会被直接裁剪</div></div>`;
    if (prop === 'white-space') return `<div class="vp-wrap" style="flex-direction:column;gap:4px;width:100%"><div style="font-size:9px;color:#52525b">nowrap</div><div style="font-size:10px;white-space:nowrap;overflow:hidden;color:#818cf8;max-width:180px">不换行不换行不换行不换行</div><div style="font-size:9px;color:#52525b">pre-wrap</div><div style="font-size:10px;white-space:pre-wrap;color:#34d399;max-width:180px">保留空白 且自动换行</div></div>`;
    if (prop === 'writing-mode') return `<div class="vp-wrap" style="gap:12px"><div style="writing-mode:vertical-rl;font-size:12px;color:#818cf8;line-height:1.8">竖排文字</div><div style="writing-mode:horizontal-tb;font-size:12px;color:#34d399">横排文字</div></div>`;
    if (prop === 'font-family') return `<div class="vp-wrap" style="flex-direction:column;align-items:flex-start;gap:3px"><div style="font-family:serif;font-size:12px;color:#818cf8">Serif 衬线体</div><div style="font-family:sans-serif;font-size:12px;color:#34d399">Sans-serif 无衬线</div><div style="font-family:monospace;font-size:12px;color:#f472b6">Monospace 等宽</div></div>`;
    if (prop === 'vertical-align') return `<div class="vp-wrap"><span style="font-size:20px;color:#d4d4d8">大字</span><span style="font-size:10px;vertical-align:super;color:#f97316">super</span><span style="font-size:10px;vertical-align:sub;color:#818cf8">sub</span><span style="font-size:20px;color:#d4d4d8">大字</span><span style="font-size:10px;vertical-align:middle;color:#34d399">mid</span></div>`;
  }

  // TRANSFORM visuals
  if (catKey === 'transform') {
    if (prop === 'transform') return `<div class="vp-wrap" style="gap:8px"><div style="width:36px;height:36px;background:rgba(129,140,248,0.3);border:2px solid #818cf8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#818cf8;transform:rotate(15deg)">旋转</div><div style="width:36px;height:36px;background:rgba(52,211,153,0.3);border:2px solid #34d399;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#34d399;transform:scale(1.3)">缩放</div><div style="width:36px;height:36px;background:rgba(244,114,182,0.3);border:2px solid #f472b6;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#f472b6;transform:skewX(15deg)">斜切</div><div style="width:36px;height:36px;background:rgba(249,115,22,0.3);border:2px solid #fb923c;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fb923c;transform:translateY(-6px)">位移</div></div>`;
    if (prop === 'translate' || prop === 'translateX' || prop === 'translateY' || prop === 'translateZ' || prop === 'translate3d') return `<div class="vp-wrap" style="position:relative;height:60px"><div style="position:absolute;width:36px;height:36px;background:rgba(129,140,248,0.1);border:1px dashed #52525b;border-radius:4px;left:10px;top:12px"></div><div style="position:absolute;width:36px;height:36px;background:rgba(129,140,248,0.3);border:2px solid #818cf8;border-radius:4px;left:30px;top:6px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#818cf8">→↓</div></div>`;
    if (prop === 'rotate' || prop === 'rotateX' || prop === 'rotateY' || prop === 'rotateZ' || prop === 'rotate3d') return `<div class="vp-wrap" style="gap:10px"><div style="width:36px;height:36px;background:rgba(129,140,248,0.3);border:2px solid #818cf8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#818cf8;transform:rotate(0deg)">0°</div><div style="width:36px;height:36px;background:rgba(52,211,153,0.3);border:2px solid #34d399;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#34d399;transform:rotate(45deg)">45°</div><div style="width:36px;height:36px;background:rgba(244,114,182,0.3);border:2px solid #f472b6;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#f472b6;transform:rotate(180deg)">180°</div></div>`;
    if (prop === 'scale' || prop === 'scaleX' || prop === 'scaleY' || prop === 'scaleZ' || prop === 'scale3d') return `<div class="vp-wrap" style="gap:10px"><div style="display:flex;align-items:center;justify-content:center"><div style="width:24px;height:24px;background:rgba(129,140,248,0.3);border:2px solid #818cf8;border-radius:4px;font-size:7px;color:#818cf8;display:flex;align-items:center;justify-content:center;transform:scale(0.6)">.6</div></div><div style="display:flex;align-items:center;justify-content:center"><div style="width:36px;height:36px;background:rgba(52,211,153,0.3);border:2px solid #34d399;border-radius:4px;font-size:8px;color:#34d399;display:flex;align-items:center;justify-content:center;transform:scale(1)">1</div></div><div style="display:flex;align-items:center;justify-content:center"><div style="width:36px;height:36px;background:rgba(244,114,182,0.3);border:2px solid #f472b6;border-radius:4px;font-size:8px;color:#f472b6;display:flex;align-items:center;justify-content:center;transform:scale(1.4)">1.4</div></div></div>`;
    if (prop === 'skew' || prop === 'skewX' || prop === 'skewY') return `<div class="vp-wrap" style="gap:10px"><div style="width:36px;height:36px;background:rgba(129,140,248,0.3);border:2px solid #818cf8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:7px;color:#818cf8">原始</div><div style="width:36px;height:36px;background:rgba(52,211,153,0.3);border:2px solid #34d399;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:7px;color:#34d399;transform:skewX(15deg)">skewX</div><div style="width:36px;height:36px;background:rgba(244,114,182,0.3);border:2px solid #f472b6;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:7px;color:#f472b6;transform:skewY(10deg)">skewY</div></div>`;
    if (prop === 'transform-origin') return `<div class="vp-wrap" style="position:relative;height:60px"><div style="width:50px;height:40px;background:rgba(129,140,248,0.2);border:1px solid #52525b;border-radius:4px;transform:rotate(15deg);transform-origin:top left;display:flex;align-items:center;justify-content:center;font-size:7px;color:#818cf8">top left</div><div style="position:absolute;bottom:6px;right:20px;width:50px;height:40px;background:rgba(249,115,22,0.2);border:1px solid #52525b;border-radius:4px;transform:rotate(15deg);transform-origin:bottom right;display:flex;align-items:center;justify-content:center;font-size:7px;color:#fb923c">btm right</div></div>`;
    if (prop === 'perspective') return `<div class="vp-wrap" style="perspective:200px;gap:8px"><div style="width:50px;height:36px;background:rgba(129,140,248,0.3);border:2px solid #818cf8;border-radius:4px;transform:rotateY(25deg);display:flex;align-items:center;justify-content:center;font-size:8px;color:#818cf8">3D</div></div>`;
    if (prop === 'backface-visibility') return `<div class="vp-wrap" style="font-size:10px;color:#71717a;flex-direction:column;gap:4px;align-items:flex-start"><div style="color:#818cf8">visible: 背面可见（默认）</div><div style="color:#f97316">hidden: 背面隐藏（翻转卡片）</div></div>`;
    if (prop === 'transform-style') return `<div class="vp-wrap" style="font-size:10px;color:#71717a;flex-direction:column;gap:4px;align-items:flex-start"><div style="color:#818cf8">flat: 子元素扁平化</div><div style="color:#34d399">preserve-3d: 子元素保持3D空间</div></div>`;
  }

  // MOTION visuals
  if (catKey === 'motion') {
    if (prop === 'transition') return `<div class="vp-wrap" style="gap:6px"><div id="${uid}" style="width:44px;height:36px;background:rgba(129,140,248,0.3);border:2px solid #818cf8;border-radius:4px;transition:all 0.4s ease;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:8px;color:#818cf8" onmouseover="this.style.transform='translateX(20px)';this.style.background='rgba(249,115,22,0.3)';this.style.borderColor='#f97316'" onmouseout="this.style.transform='';this.style.background='rgba(129,140,248,0.3)';this.style.borderColor='#818cf8'">hover→</div><div style="font-size:9px;color:#52525b">悬停查看过渡效果</div></div>`;
    if (prop === 'transition-timing-function') return `<div class="vp-wrap" style="flex-direction:column;gap:6px;width:100%;align-items:stretch"><div style="font-size:9px;color:#52525b;display:flex;justify-content:space-between"><span>ease</span><span>→</span></div><div style="height:6px;background:rgba(129,140,248,0.2);border-radius:3px;overflow:hidden"><div style="width:100%;height:100%;background:#818cf8;border-radius:3px;animation:${uid}a 2s ease infinite"></div></div><div style="font-size:9px;color:#52525b;display:flex;justify-content:space-between"><span>linear</span><span>→</span></div><div style="height:6px;background:rgba(52,211,153,0.2);border-radius:3px;overflow:hidden"><div style="width:100%;height:100%;background:#34d399;border-radius:3px;animation:${uid}b 2s linear infinite"></div></div><style>@keyframes ${uid}a{0%{width:0}50%{width:100%}100%{width:0}}@keyframes ${uid}b{0%{width:0}50%{width:100%}100%{width:0}}</style></div>`;
    if (prop === 'animation' || prop === 'animation-name' || prop === '@keyframes') return `<div class="vp-wrap" style="gap:8px"><div style="width:36px;height:36px;background:rgba(129,140,248,0.3);border:2px solid #818cf8;border-radius:4px;animation:vp-bounce 1s ease infinite;display:flex;align-items:center;justify-content:center;font-size:8px;color:#818cf8">弹跳</div><div style="width:36px;height:36px;background:rgba(52,211,153,0.3);border:2px solid #34d399;border-radius:4px;animation:vp-spin 2s linear infinite;display:flex;align-items:center;justify-content:center;font-size:8px;color:#34d399">旋转</div><div style="width:36px;height:36px;background:rgba(244,114,182,0.3);border:2px solid #f472b6;border-radius:4px;animation:vp-pulse 1.5s ease infinite;display:flex;align-items:center;justify-content:center;font-size:8px;color:#f472b6">脉冲</div></div>`;
    if (prop === 'animation-direction') return `<div class="vp-wrap" style="gap:8px"><div style="display:flex;flex-direction:column;align-items:center;gap:2px"><div style="width:30px;height:30px;background:rgba(129,140,248,0.3);border:2px solid #818cf8;border-radius:4px;animation:vp-move 1.5s ease infinite;display:flex;align-items:center;justify-content:center;font-size:7px;color:#818cf8">normal</div><div style="font-size:8px;color:#52525b">→ → → |</div></div><div style="display:flex;flex-direction:column;align-items:center;gap:2px"><div style="width:30px;height:30px;background:rgba(52,211,153,0.3);border:2px solid #34d399;border-radius:4px;animation:vp-move 1.5s ease infinite alternate;display:flex;align-items:center;justify-content:center;font-size:7px;color:#34d399">alt</div><div style="font-size:8px;color:#52525b">→ → ← ←</div></div></div>`;
    if (prop === 'animation-fill-mode') return `<div class="vp-wrap" style="font-size:10px;color:#71717a;flex-direction:column;gap:4px;align-items:flex-start"><div style="color:#52525b">none: 动画结束回到初始状态</div><div style="color:#34d399">forwards: 停在最后一帧 ✓ 最常用</div><div style="color:#818cf8">backwards: 未开始时显示首帧</div><div style="color:#f472b6">both: forwards + backwards</div></div>`;
    if (prop === 'animation-play-state') return `<div class="vp-wrap" style="gap:8px"><div style="width:36px;height:36px;background:rgba(129,140,248,0.3);border:2px solid #818cf8;border-radius:4px;animation:vp-spin 2s linear infinite;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:7px;color:#818cf8" onclick="this.style.animationPlayState=this.style.animationPlayState==='paused'?'running':'paused'">点暂停</div><div style="font-size:9px;color:#52525b">点击暂停/恢复</div></div>`;
    if (prop === 'will-change') return `<div class="vp-wrap" style="font-size:10px;color:#71717a;flex-direction:column;gap:4px;align-items:flex-start"><div style="color:#f97316">⚠️ 不要滥用，只在需要时设置</div><div style="color:#818cf8">will-change: transform;</div><div style="color:#34d399">will-change: opacity;</div><div style="color:#52525b">提示浏览器提前优化</div></div>`;
    if (prop === 'scroll-behavior') return `<div class="vp-wrap" style="font-size:10px;color:#71717a;flex-direction:column;gap:4px;align-items:flex-start"><div style="color:#818cf8">auto: 立即跳转（默认）</div><div style="color:#34d399">smooth: 平滑滚动 ✓ 推荐</div><div style="font-family:monospace;font-size:9px;color:#52525b;background:rgba(255,255,255,0.03);padding:4px 8px;border-radius:4px">html { scroll-behavior: smooth; }</div></div>`;
    if (prop === 'animation-timeline') return `<div class="vp-wrap" style="font-size:10px;color:#71717a;flex-direction:column;gap:4px;align-items:flex-start"><div style="color:#818cf8">auto: 基于时间（默认）</div><div style="color:#34d399">scroll(): 基于滚动位置</div><div style="color:#f472b6">view(): 基于元素可见性</div></div>`;
  }

  return `<div class="vp-wrap"><div style="padding:6px 14px;background:rgba(129,140,248,0.1);border:1px dashed #818cf8;border-radius:6px;font-size:10px;color:#818cf8;font-family:monospace">${prop}</div></div>`;
}

// ===== CSS syntax highlighter (escapes HTML, marks comments/keywords) =====
export function hlCSS(c) {
  return c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/(\/\*[\s\S]*?\*\/)/g,'<span class="cm">$1</span>')
    .replace(/([\w@\-]+)(\s*:\s*)(?!\/\/)/g,'<span class="kw">$1</span>$2');
}
