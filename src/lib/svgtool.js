// ===================== SVG 工具类 (Pro 增强版) =====================
// 纯前端、零依赖的 SVG 处理内核：解析 / 压缩 / 格式化 / 重着色 / 缩放 / Base64 / 安全净化。
// 仅使用浏览器原生 API（DOMParser / XMLSerializer / TextEncoder / btoa 等），
// 与 LocalForge「纯浏览器端、文件不上传」的理念一致。
export class SVGTool {
  static getViewBox(svg) {
    if (!svg || typeof svg !== 'string') return null;
    const m = svg.match(/<svg[^>]*\bviewBox\s*=\s*["']([^"']+)["']/i);
    if (!m) return null;
    try {
      const parts = m[1].trim().split(/[\s,]+/).map(Number);
      if (parts.length >= 4 && parts.every(p => !isNaN(p))) return [parts[0], parts[1], parts[2], parts[3]];
    } catch (e) {}
    return null;
  }

  static getSize(svg) {
    const res = { width: null, height: null, viewBox: null, rawWidth: null, rawHeight: null };
    const vb = SVGTool.getViewBox(svg);
    if (vb) {
      res.viewBox = { minX: vb[0], minY: vb[1], width: vb[2], height: vb[3] };
      res.width = vb[2]; res.height = vb[3];
    }
    const wm = svg.match(/<svg[^>]*\bwidth\s*=\s*["']([^"']+)["']/i);
    const hm = svg.match(/<svg[^>]*\bheight\s*=\s*["']([^"']+)["']/i);
    if (wm) {
      res.rawWidth = wm[1];
      const p = SVGTool._parseDim(wm[1]);
      if (p !== null && res.width === null) res.width = p;
    }
    if (hm) {
      res.rawHeight = hm[1];
      const p = SVGTool._parseDim(hm[1]);
      if (p !== null && res.height === null) res.height = p;
    }
    return res;
  }

  static _parseDim(d) {
    if (!d) return null; d = d.trim();
    const m = d.match(/^([-+]?\d*\.?\d+)\s*(px|pt|cm|mm|in|em|ex|%)?$/i);
    if (!m) return null;
    const val = parseFloat(m[1]), unit = (m[2] || 'px').toLowerCase();
    const map = { px: 1, pt: 1.333, cm: 37.795, mm: 3.7795, in: 96, em: 16, ex: 8 };
    if (unit === '%') return null;
    return Math.round(val * (map[unit] || 1) * 100) / 100;
  }

  static _setDimensions(svg, w, h, unit = 'px') {
    let r = svg;
    const dw = unit === 'px' ? `${w}` : `${w}${unit}`;
    const dh = unit === 'px' ? `${h}` : `${h}${unit}`;
    if (/<svg[^>]*\bwidth\s*=\s*["']/i.test(r)) r = r.replace(/(<svg[^>]*\bwidth\s*=\s*["'])([^"']*)(["'])/i, `$1${dw}$3`);
    else r = r.replace(/<svg/i, m => `${m} width="${dw}"`);
    if (/<svg[^>]*\bheight\s*=\s*["']/i.test(r)) r = r.replace(/(<svg[^>]*\bheight\s*=\s*["'])([^"']*)(["'])/i, `$1${dh}$3`);
    else r = r.replace(/<svg/i, m => `${m} height="${dh}"`);
    return r;
  }

  static _setPreserveAspectRatio(svg, val) {
    if (/<svg[^>]*\bpreserveAspectRatio\s*=\s*["']/i.test(svg)) return svg.replace(/(<svg[^>]*\bpreserveAspectRatio\s*=\s*["'])([^"']*)(["'])/i, `$1${val}$3`);
    return svg.replace(/<svg/i, m => `${m} preserveAspectRatio="${val}"`);
  }

  static resizeToWidth(svg, w, unit = 'px') {
    const s = SVGTool.getSize(svg);
    if (!s.width || !s.height) return svg;
    const h = Math.round(w * (s.height / s.width) * 100) / 100;
    return SVGTool._setDimensions(svg, w, h, unit);
  }
  static resizeToHeight(svg, h, unit = 'px') {
    const s = SVGTool.getSize(svg);
    if (!s.width || !s.height) return svg;
    const w = Math.round(h * (s.width / s.height) * 100) / 100;
    return SVGTool._setDimensions(svg, w, h, unit);
  }
  static resizeContain(svg, mw, mh, unit = 'px') {
    const s = SVGTool.getSize(svg);
    if (!s.width || !s.height) return svg;
    const sc = Math.min(mw / s.width, mh / s.height);
    const fw = Math.round(s.width * sc * 100) / 100, fh = Math.round(s.height * sc * 100) / 100;
    return SVGTool._setPreserveAspectRatio(SVGTool._setDimensions(svg, fw, fh, unit), 'xMidYMid meet');
  }
  static resizeCover(svg, tw, th, unit = 'px') {
    const s = SVGTool.getSize(svg);
    if (!s.width || !s.height) return svg;
    const sc = Math.max(tw / s.width, th / s.height);
    const fw = Math.round(s.width * sc * 100) / 100, fh = Math.round(s.height * sc * 100) / 100;
    return SVGTool._setPreserveAspectRatio(SVGTool._setDimensions(svg, fw, fh, unit), 'xMidYMid slice');
  }
  static setSize(svg, w, h, unit = 'px') { return SVGTool._setDimensions(svg, w, h, unit); }

  static resizeViewBox(svg, targetW, targetH, mode = 'meet') {
    const vb = SVGTool.getViewBox(svg);
    if (!vb) {
      const s = SVGTool.getSize(svg);
      const w = s.width || targetW, h = s.height || targetH;
      let r = svg.replace(/^<svg/i, `<svg viewBox="0 0 ${targetW} ${targetH}"`);
      return SVGTool._setDimensions(r, targetW, targetH);
    }
    const vbW = vb[2], vbH = vb[3];
    const scaleW = targetW / vbW, scaleH = targetH / vbH;
    const finalScale = mode === 'meet' ? Math.min(scaleW, scaleH) : Math.max(scaleW, scaleH);
    const newVbW = targetW / finalScale, newVbH = targetH / finalScale;
    const newX = vb[0] + (vbW - newVbW) / 2, newY = vb[1] + (vbH - newVbH) / 2;
    const newViewBox = `${newX.toFixed(2)} ${newY.toFixed(2)} ${newVbW.toFixed(2)} ${newVbH.toFixed(2)}`;
    let r = svg.replace(/(<svg[^>]*)\bviewBox\s*=\s*["'][^"']*["']/i, `$1viewBox="${newViewBox}"`);
    r = SVGTool._setDimensions(r, targetW, targetH);
    return SVGTool._setPreserveAspectRatio(r, 'none');
  }

  static _removeNonEssentialAttrs(svg, removeClass = false) {
    let result = svg;
    result = result.replace(/<[^>]+>/g, (tag) => {
      tag = tag.replace(/\s+t\s*=\s*["'][^"']*["']/gi, '');
      tag = tag.replace(/\s+p-id\s*=\s*["'][^"']*["']/gi, '');
      tag = tag.replace(/\s+data-[a-zA-Z0-9_-]+\s*=\s*["'][^"']*["']/gi, '');
      if (removeClass) {
        tag = tag.replace(/\s+class\s*=\s*["'][^"']*["']/gi, '');
      }
      return tag;
    });
    return result;
  }

  static compress(svg, opts = {}) {
    const o = {
      removeComments: true, removeXMLDecl: true, removeDoctype: true,
      removeMetadata: true, collapseWhitespace: true, compressPathData: true,
      pathPrecision: 2, shortenColors: true, removeEmptyDefs: true,
      removeVersion: true, compressStyleAttr: true,
      removeUnusedNamespaces: false, removeDefaultAttributes: false,
      removeNonEssentialAttrs: false,
      removeClass: false,
      ...opts
    };
    let r = svg;
    if (o.removeXMLDecl) r = r.replace(/<\?xml[^?]*\?>\s*/gi, '');
    if (o.removeDoctype) r = r.replace(/<!DOCTYPE[^>]*>\s*/gi, '');
    if (o.removeComments) r = r.replace(/<!--[\s\S]*?-->/g, '');
    if (o.removeMetadata) {
      r = r.replace(/<metadata[\s\S]*?<\/metadata>/gi, '');
      r = r.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '');
      r = r.replace(/<desc[^>]*>[\s\S]*?<\/desc>/gi, '');
    }
    if (o.removeEmptyDefs) r = r.replace(/<defs[^>]*>\s*<\/defs>/gi, '');
    if (o.removeVersion) r = r.replace(/\s+version\s*=\s*["'][^"']*["']/gi, '');
    if (o.removeUnusedNamespaces) {
      r = r.replace(/\s+xmlns:([a-zA-Z0-9_-]+)\s*=\s*["'][^"']*["']/gi, (match, prefix) => {
        if (!new RegExp(`<[^>]*\b${prefix}:`, 'i').test(r)) return '';
        return match;
      });
    }
    if (o.removeDefaultAttributes) {
      r = r.replace(/\s+stroke-width\s*=\s*["']1["']/gi, '');
      r = r.replace(/\s+stroke\s*=\s*["']none["']/gi, '');
      r = r.replace(/\s+fill\s*=\s*["']black["']/gi, '');
      r = r.replace(/\s+fill-rule\s*=\s*["']nonzero["']/gi, '');
      r = r.replace(/\s+clip-rule\s*=\s*["']nonzero["']/gi, '');
    }
    if (o.removeNonEssentialAttrs || o.removeClass) {
      r = SVGTool._removeNonEssentialAttrs(r, o.removeClass);
    }
    if (o.collapseWhitespace) { r = r.replace(/>\s+</g, '><'); r = r.replace(/\s{2,}/g, ' '); r = r.replace(/^\s+|\s+$/gm, ''); }
    if (o.compressPathData) r = SVGTool._compressAllPaths(r, o.pathPrecision);
    if (o.shortenColors) r = SVGTool._shortenColors(r);
    if (o.compressStyleAttr) r = SVGTool._compressStyleAttrs(r);
    return r.trim();
  }

  static extremeCompress(svg) {
    return SVGTool.compress(svg, {
      pathPrecision: 1,
      removeUnusedNamespaces: true,
      removeDefaultAttributes: true,
      removeNonEssentialAttrs: true,
      removeClass: true
    });
  }

  static _compressAllPaths(svg, prec) {
    return svg.replace(/\bd\s*=\s*["']([^"']*)["']/gi, (m, d) => m.replace(d, SVGTool.compressPathData(d, prec)));
  }

  static _shortenColors(svg) {
    return svg.replace(/(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\([^"]*?\))/g, color => SVGTool.shortenColor(color));
  }

  static _compressStyleAttrs(svg) {
    return svg.replace(/\bstyle\s*=\s*["']([^"']*)["']/gi, (m, s) => {
      let c = s.replace(/\s*:\s*/g, ':').replace(/\s*;\s*/g, ';').replace(/;\s*$/, '').replace(/\s+/g, ' ');
      c = c.replace(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, x => SVGTool.shortenColor(x));
      c = c.replace(/rgba?\([^"]*?\)/g, x => SVGTool.shortenColor(x));
      return m.replace(s, c);
    });
  }

  static compressPathData(d, prec = 2) {
    if (!d) return d;
    const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.?\d+|\d+\.\d+)(?:[eE][-+]?\d+)?/g) || [];
    const res = tokens.map(t => /^[a-z]$/i.test(t) ? t : SVGTool._fmtNum(parseFloat(t), prec));
    let out = '';
    for (let i = 0; i < res.length; i++) {
      const cur = res[i], prev = res[i-1] || '';
      if (/^[a-z]$/i.test(cur)) {
        if (i > 0 && !/^[a-z]$/i.test(prev)) out += ' ';
        out += cur;
      } else {
        if (!/^[a-z]$/i.test(prev) && i > 0) out += ' ';
        out += cur;
      }
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  static _fmtNum(num, prec) {
    const r = parseFloat(num.toFixed(prec));
    if (r === 0) return '0';
    let s = r.toString();
    if (prec > 0 && Math.abs(r) < 1 && r !== 0) {
      if (s.startsWith('0.')) s = s.slice(1);
      else if (s.startsWith('-0.')) s = '-.' + s.slice(3);
    }
    return s;
  }

  static getPathStats(d) {
    const cmds = (d.match(/[MmLlHhVvCcSsQqTtAaZz]/g) || []).length;
    const nums = (d.match(/[-+]?\d*\.?\d+/g) || []).length;
    return { commands: cmds, points: Math.floor(nums/2), rawLength: d.length };
  }

  static simplifyPath(points, tolerance = 0.5) {
    if (points.length < 3) return points;
    const sqSegDist = (p, p1, p2) => {
      let x = p1[0], y = p1[1], dx = p2[0]-x, dy = p2[1]-y;
      if (dx !== 0 || dy !== 0) {
        let t = ((p[0]-x)*dx + (p[1]-y)*dy) / (dx*dx + dy*dy);
        if (t > 1) { x = p2[0]; y = p2[1]; }
        else if (t > 0) { x += dx*t; y += dy*t; }
      }
      dx = p[0]-x; dy = p[1]-y;
      return dx*dx + dy*dy;
    };
    const simplifyDPStep = (pts, first, last, sqTol, simplified) => {
      let maxSqDist = sqTol, index;
      for (let i = first+1; i < last; i++) {
        const sqDist = sqSegDist(pts[i], pts[first], pts[last]);
        if (sqDist > maxSqDist) { index = i; maxSqDist = sqDist; }
      }
      if (maxSqDist > sqTol) {
        if (index - first > 1) simplifyDPStep(pts, first, index, sqTol, simplified);
        simplified.push(pts[index]);
        if (last - index > 1) simplifyDPStep(pts, index, last, sqTol, simplified);
      }
    };
    const last = points.length-1;
    const simplified = [points[0]];
    simplifyDPStep(points, 0, last, tolerance*tolerance, simplified);
    simplified.push(points[last]);
    return simplified;
  }

  static compressPathDataWithSimplification(d, precision=2, tolerance=0.5) {
    if (!d) return d;
    if (/[CcSsQqTtAa]/.test(d)) return SVGTool.compressPathData(d, precision);
    const tokens = d.match(/[MmLlHhVvZz]|[-+]?(?:\d*\.?\d+|\d+\.\d+)(?:[eE][-+]?\d+)?/g) || [];
    if (tokens.length < 7) return SVGTool.compressPathData(d, precision);
    const points = []; let cx=0, cy=0, startX=0, startY=0, cmd='';
    for (let i=0; i<tokens.length; i++) {
      let t = tokens[i];
      if (/^[a-zA-Z]$/.test(t)) { cmd = t; i++; if (cmd==='Z'||cmd==='z') { cx=startX; cy=startY; i--; continue; } t = tokens[i]; }
      switch(cmd) {
        case 'M': case 'L': cx=parseFloat(t); cy=parseFloat(tokens[++i]); points.push([cx,cy]); if(cmd==='M'){startX=cx;startY=cy;cmd='L';} break;
        case 'm': case 'l': cx+=parseFloat(t); cy+=parseFloat(tokens[++i]); points.push([cx,cy]); if(cmd==='m'){startX=cx;startY=cy;cmd='l';} break;
        case 'H': cx=parseFloat(t); points.push([cx,cy]); break;
        case 'h': cx+=parseFloat(t); points.push([cx,cy]); break;
        case 'V': cy=parseFloat(t); points.push([cx,cy]); break;
        case 'v': cy+=parseFloat(t); points.push([cx,cy]); break;
      }
    }
    if (points.length < 3) return SVGTool.compressPathData(d, precision);
    const simplified = SVGTool.simplifyPath(points, tolerance);
    let newPath = `M${SVGTool._fmtNum(simplified[0][0],precision)} ${SVGTool._fmtNum(simplified[0][1],precision)}`;
    for (let i=1; i<simplified.length; i++) newPath += `L${SVGTool._fmtNum(simplified[i][0],precision)} ${SVGTool._fmtNum(simplified[i][1],precision)}`;
    if (/z/i.test(d.slice(-1))) newPath += 'Z';
    return newPath;
  }

  static escapeRegExp(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  static colorToRgb(color) {
    if (!color) return null; color = color.trim();
    let m = color.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
    if (m) return [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)];
    m = color.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/);
    if (m) return [parseInt(m[1]+m[1],16), parseInt(m[2]+m[2],16), parseInt(m[3]+m[3],16)];
    m = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }

  static shortenColor(c) {
    if (!c) return c; c = c.trim();
    let m = c.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
    if (m) {
      if (m[1][0]===m[1][1] && m[2][0]===m[2][1] && m[3][0]===m[3][1]) return `#${m[1][0]}${m[2][0]}${m[3][0]}`.toLowerCase();
      return c.toLowerCase();
    }
    m = c.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/);
    if (m) return c.toLowerCase();
    m = c.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (m) {
      const toHex = v => Math.max(0,Math.min(255,+v)).toString(16).padStart(2,'0');
      return SVGTool.shortenColor(`#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`);
    }
    return c;
  }

  static extractColors(svg) {
    if (!svg) return [];
    const colorRegex = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/g;
    const matches = svg.match(colorRegex) || [];
    const seen = new Set(), result = [];
    matches.forEach(c => {
      const rgb = SVGTool.colorToRgb(c);
      if (rgb) {
        const hex6 = '#' + rgb.map(v => v.toString(16).padStart(2,'0')).join('');
        if (!seen.has(hex6)) { seen.add(hex6); result.push(hex6); }
      }
    });
    return result;
  }

  static replaceColor(svg, oldColor, newColor) {
    const rgb = SVGTool.colorToRgb(oldColor);
    if (!rgb) return svg;
    const hex6 = '#' + rgb.map(c => c.toString(16).padStart(2,'0')).join('');
    const hex3 = (hex6[1]===hex6[3] && hex6[3]===hex6[5]) ? `#${hex6[1]}${hex6[3]}${hex6[5]}` : null;
    const rgbStr = String.raw`rgb\(\s*${rgb[0]}\s*,\s*${rgb[1]}\s*,\s*${rgb[2]}\s*\)`;
    const rgbaStr = String.raw`rgba\(\s*${rgb[0]}\s*,\s*${rgb[1]}\s*,\s*${rgb[2]}\s*,\s*([\d.]+)\s*\)`;
    const finalNewColor = SVGTool.shortenColor(newColor);
    const newRgb = SVGTool.colorToRgb(finalNewColor);
    let result = svg;
    result = result.replace(new RegExp(SVGTool.escapeRegExp(hex6)+'\\b', 'gi'), finalNewColor);
    if (hex3) result = result.replace(new RegExp(SVGTool.escapeRegExp(hex3)+'\\b', 'gi'), finalNewColor);
    result = result.replace(new RegExp(rgbStr, 'gi'), finalNewColor);
    if (newRgb) {
      result = result.replace(new RegExp(rgbaStr, 'gi'), (match, alpha) => `rgba(${newRgb[0]},${newRgb[1]},${newRgb[2]},${alpha})`);
    } else {
      result = result.replace(new RegExp(rgbaStr, 'gi'), finalNewColor);
    }
    return result;
  }

  static analyzeOptimization(svg) {
    const report = { originalSize: svg.length, issues: [], potentialSavings: 0 };
    const hidden = svg.match(/<[^>]*(?:display\s*=\s*["']none["']|opacity\s*=\s*["']0(?:\.0+)?["'])[^>]*>/gi) || [];
    if (hidden.length) { const s = hidden.reduce((a,e)=>a+e.length,0); report.issues.push({type:'hidden_elements',severity:'medium',msg:`发现 ${hidden.length} 个隐藏元素`,detail:'可安全移除以减小体积。',savings:s}); report.potentialSavings+=s; }
    const empty = svg.match(/<(g|defs|symbol|mask)[^>]*>\s*<\/\1>/gi) || [];
    if (empty.length) { const s = empty.reduce((a,e)=>a+e.length,0); report.issues.push({type:'empty_containers',severity:'low',msg:`发现 ${empty.length} 个空容器`,detail:'移除可清洁代码。',savings:s}); report.potentialSavings+=s; }
    const paths = svg.match(/<path[^>]*d\s*=\s*["']([^"']*)["']/gi) || [];
    let complexCount=0, pathSavings=0;
    paths.forEach(p => {
      const dm = p.match(/d\s*=\s*["']([^"']*)["']/i); if(!dm) return;
      const stats = SVGTool.getPathStats(dm[1]);
      if (stats.points > 30 && !/[CcSsQqTtAa]/.test(dm[1])) { complexCount++; pathSavings += Math.round(stats.rawLength*0.4); }
    });
    if (complexCount) { report.issues.push({type:'complex_path',severity:'high',msg:`发现 ${complexCount} 个可简化路径`,detail:'建议使用道格拉斯-普克算法简化。',savings:pathSavings}); report.potentialSavings+=pathSavings; }
    const colors = svg.match(/#[0-9a-fA-F]{6}\b/g) || [];
    const uniqueColors = new Set(colors.map(c=>c.toLowerCase()));
    const dupCount = colors.length - uniqueColors.size;
    if (dupCount > 2) { const s = dupCount*3; report.issues.push({type:'duplicate_colors',severity:'low',msg:`发现 ${dupCount} 个重复颜色`,detail:'可转为#RGB格式。',savings:s}); report.potentialSavings+=s; }
    const ws = svg.match(/>\s+<|\s{2,}/g) || [];
    if (ws.length > 5) { const s = ws.reduce((a,m)=>a+m.length-1,0); report.issues.push({type:'whitespace',severity:'medium',msg:'大量冗余空白',detail:'移除可提升加载速度。',savings:s}); report.potentialSavings+=s; }
    return report;
  }

  static format(svg, indent=2) {
    try {
      const parser = new DOMParser(); const doc = parser.parseFromString(svg, 'image/svg+xml');
      if (doc.querySelector('parsererror')) throw new Error('parse error');
      const serializer = new XMLSerializer(); let xml = serializer.serializeToString(doc);
      let result='', level=0;
      const tokens = xml.split(/(<[^>]+>)/g).filter(Boolean);
      for (let t of tokens) {
        if (t.startsWith('</')) level = Math.max(0, level-1);
        result += ' '.repeat(level*indent) + t.trim() + '\n';
        if (t.startsWith('<') && !t.startsWith('</') && !t.endsWith('/>') && !t.includes('?>')) level++;
      }
      return result.replace(/\n\s*\n/g,'\n').trim();
    } catch(e) { return svg.replace(/>\s*<\//g,'>\n</').replace(/></g,'>\n<'); }
  }

  static minify(svg) { return svg.replace(/<!--[\s\S]*?-->/g,'').replace(/>\s+</g,'><').replace(/\s{2,}/g,' ').trim(); }

  static toBase64(svg) {
    try {
      const encoder = new TextEncoder(); const bytes = encoder.encode(svg);
      const CHUNK_SIZE = 0x8000; let binary = '';
      for (let i=0; i<bytes.length; i+=CHUNK_SIZE) {
        const chunk = bytes.subarray(i, Math.min(i+CHUNK_SIZE, bytes.length));
        binary += String.fromCharCode.apply(null, chunk);
      }
      return btoa(binary);
    } catch(e) { return btoa(svg); }
  }

  static fromBase64(b64) {
    try {
      const binary = atob(b64); const bytes = new Uint8Array(binary.length);
      for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch(e) { return atob(b64); }
  }

  static addDataURIPrefix(b64) { return /^data:/.test(b64) ? b64 : 'data:image/svg+xml;base64,' + b64; }
  static removeDataURIPrefix(uri) { const m = uri.match(/^data:[^;]*;base64,(.+)$/i); return m ? m[1] : uri; }
  static isDataURI(str) { return /^data:/i.test(str); }

  // 安全净化：预览前剥离 <script>、事件处理属性与 javascript: 协议，防止 XSS。
  static sanitizeSVG(svg) {
    if (!svg) return '';
    let s = String(svg);
    s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<script\b[^>]*\/?>/gi, '');
    s = s.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
    s = s.replace(/(?:href|xlink:href|src)\s*=\s*["']\s*javascript:[^"']*["']/gi, '$1=""');
    return s;
  }
}

// 引擎自检：覆盖纯算法与浏览器端管线，供 SelfTestPanel「运行全部自检」调用。
export async function selfTest() {
  const items = []
  const T = async (id, title, fn) => {
    try { const detail = await fn(); items.push({ id, title, ok: true, detail }) }
    catch (e) { items.push({ id, title, ok: false, error: { message: e.message, stack: e.stack } }) }
  }
  const sample = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><!-- c --><rect fill="#ff0000"/><path d="M0 0L10 10" stroke="#345678"/></svg>'
  await T('getViewBox', '解析 viewBox', () => { const v = SVGTool.getViewBox(sample); if (!v || v.join(' ') !== '0 0 100 100') throw new Error('viewBox 解析错误'); return v.join(' ') })
  await T('extractColors', '提取颜色', () => { const c = SVGTool.extractColors(sample); if (!c.includes('#ff0000') || !c.includes('#345678')) throw new Error('颜色提取缺失'); return c.length + ' 色' })
  await T('compress', '压缩去注释/空白', () => { const s = SVGTool.compress(sample); if (s.includes('<!--') || s.length >= sample.length) throw new Error('压缩无效'); return s.length + ' 字节' })
  await T('extremeCompress', '极致压缩去 class', () => { const s = SVGTool.extremeCompress(sample); if (/class\s*=/.test(s)) throw new Error('仍含 class'); return s.length + ' 字节' })
  await T('replaceColor', 'rgb() 重着色', () => { const s = SVGTool.replaceColor(sample.replace('#ff0000', 'rgb(255,0,0)'), 'rgb(255,0,0)', '#00ff00'); if (!s.includes('#00ff00') && !s.includes('#0f0')) throw new Error('rgb 重着色失败'); return 'ok' })
  await T('sanitizeSVG', 'XSS 净化', () => { const s = SVGTool.sanitizeSVG('<svg onload="x()"><script>bad()</script></svg>'); if (/on\w+=/.test(s) || /<script/i.test(s)) throw new Error('净化失败'); return 'ok' })
  await T('base64-roundtrip', 'Base64 往返', () => { const d = SVGTool.fromBase64(SVGTool.removeDataURIPrefix(SVGTool.addDataURIPrefix(SVGTool.toBase64(sample)))); if (d !== sample) throw new Error('往返不一致'); return 'ok' })
  await T('resizeToWidth', '按宽度缩放', () => { const s = SVGTool.resizeToWidth(sample, 50); if (!/width="50"/.test(s)) throw new Error('缩放失败'); return 'ok' })
  await T('format', '格式化带缩进', () => { const s = SVGTool.format(sample); if (!s.includes('<svg')) throw new Error('格式化失败'); return 'ok' })
  await T('analyzeOptimization', '优化分析', () => { const r = SVGTool.analyzeOptimization(sample); if (typeof r.originalSize !== 'number') throw new Error('结构异常'); return 'ok' })
  return { module: 'svgtool', items }
}

export default SVGTool;
