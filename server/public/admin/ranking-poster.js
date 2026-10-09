/* Render the saved close ranking, with only the first stock expanded. No upstream queries. */
function drawRankingPoster(ranking, side) {
  if (!['inflow', 'outflow'].includes(side)) throw new Error('榜单类型无效');
  const rows = ranking && Array.isArray(ranking[side]) ? ranking[side].slice(0, 10) : [];
  if (!rows.length) throw new Error('请先生成有效暗盘榜');
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 380 + rows.length * 106 + 640;
  const ctx = canvas.getContext('2d');
  const red = '#ff3b30', green = '#00a84f', ink = '#202735';
  const number = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
  const color = (v) => number(v) === null ? '#9299a4' : Number(v) >= 0 ? red : green;
  function text(value, x, y, size = 28, fill = ink, align = 'left', bold = false) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px "Microsoft YaHei",sans-serif`;
    ctx.fillStyle = fill; ctx.textAlign = align;
    ctx.fillText(String(value), x, y);
  }
  function box(x, y, w, h, fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  function rounded(x,y,w,h,r,fill,stroke) {
    ctx.beginPath(); ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.5;ctx.stroke();}
  }
  function unit(row) {
    return Math.max(...['grey', 'listed', 'main', 'retail'].map((key) => Math.abs(number(row[key]) || 0))) >= 1e8 ? 1e8 : 1e4;
  }
  function money(value, divisor) {
    return number(value) === null ? '—' : `${Number(value) > 0 ? '+' : ''}${(Number(value) / divisor).toFixed(divisor === 1e8 ? 2 : 1)}${divisor === 1e8 ? '亿' : '万'}`;
  }
  box(0, 0, 1080, canvas.height, '#ffffff');
  box(0, 0, 1080, 12, side === 'inflow' ? red : green);
  const date = String(ranking.tradeDate || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!date) throw new Error('榜单交易日期无效');
  text(`${Number(date[1])}月${Number(date[2])}日同花顺热股暗盘榜`, 48, 90, 42, ink, 'left', true);
  text(`暗盘${side === 'inflow' ? '流入' : '流出'}前${rows.length === 10 ? '十' : rows.length}名`, 48, 157, 36, side === 'inflow' ? red : green, 'left', true);
  text('数据来源【指标仓库】小程序', 1032, 157, 24, '#7a8290', 'right');
  box(36, 192, 1008, 65, '#f3f5f8');
  [['股票名称', 110, 'left'], ['涨跌幅', 560, 'right'], ['暗盘资金', 790, 'right'], ['明盘资金', 1015, 'right']].forEach(([label,x,align]) => text(label,x,235,26,'#737b87',align));
  let y = 266;
  rows.forEach((row, index) => {
    const divisor = unit(row);
    text(index + 1, 65, y + 60, 30, index === 0 ? red : '#8c939d', 'center', true);
    // Fit full names without abbreviating or exposing stock codes.
    let size = 30;
    ctx.font = `bold ${size}px "Microsoft YaHei",sans-serif`;
    while (ctx.measureText(row.stockName || '').width > 305 && size > 18) { size--; ctx.font = `bold ${size}px "Microsoft YaHei",sans-serif`; }
    text(row.stockName || '未知股票',110,y+60,size,ink,'left',true);
    text(number(row.changePercent) === null ? '—' : `${Number(row.changePercent)>0?'+':''}${Number(row.changePercent).toFixed(2)}%`,560,y+60,27,color(row.changePercent),'right');
    text(money(row.grey,divisor),790,y+60,27,color(row.grey),'right');
    text(money(row.listed,divisor),1015,y+60,27,color(row.listed),'right');
    y += 106;
    if (index === 0) {
      rounded(48,y,984,620,20,'#fafafa','#e5e5e5');
      text(`主力流向（${divisor===1e8?'亿元':'万元'}）`,80,y+52,32,ink,'left',true);
      rounded(80,y+78,920,132,16,'#f0f1f2');
      text('主力净流入',310,y+126,26,'#777','center');
      text(money(row.main,divisor),310,y+174,34,color(row.main),'center',true);
      text('散户流入',770,y+126,26,'#777','center');
      text(money(row.retail,divisor),770,y+174,34,color(row.retail),'center',true);
      const bars = [['主力明盘',row.listed],['主力暗盘',row.grey],['散户流入',row.retail]];
      const max = Math.max(1,...bars.map(([,v])=>Math.abs(number(v)||0)));
      const zero = y+390;
      box(80,zero,920,1.5,'#cfd3d8');
      bars.forEach(([label,value],i)=>{
        const x=233+i*307, v=number(value), height=v===null||v===0?0:Math.max(8,Math.abs(v)/max*128);
        if(height) box(x-24,v>=0?zero-height:zero,48,height,color(v));
        text(money(value,divisor),x,v===null?zero-18:v>=0?zero-height-16:zero+height+32,26,color(v),'center',true);
        text(label,x,y+593,28,'#666','center');
      });
      y+=640;
    }
    box(48,y-1,984,1,'#e7e9ee');
  });
  text('数据来自互联网和AI工具，不构成投资建议',540,y+55,25,'#8b929c','center');
  return canvas;
}
