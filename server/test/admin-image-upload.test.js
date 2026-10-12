const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {EventEmitter}=require('node:events');
function backend(){
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/upload.js'),'utf8'),{module,Buffer,__dirname:path.join(__dirname,'../src'),require:id=>({
    fs:{mkdirSync(){},writeFileSync(){}},'./auth':{userIdFor:()=>null,isAdmin:()=>true},'./audit':{record(){}},'./db':{flush:async()=>{}}
  }[id]||require(id))});return module.exports;
}
const jpg=Buffer.from('ffd8ffc00011080001000103011100021100031100ffd9','hex');
test('JPEG MIME aliases and missing binary MIME upload successfully',async()=>{
  const upload=backend();
  for(const type of ['image/jpeg','image/jpg','image/pjpeg','IMAGE/JPEG; charset=binary','application/octet-stream','']){
    const req=new EventEmitter();req.headers={authorization:'admin',host:'example.test','content-type':'multipart/form-data; boundary=test'};req.socket={};
    const response=new Promise(resolve=>upload.handleUpload(req,{},(_,status,data)=>resolve({status,data})));
    req.emit('data',Buffer.concat([Buffer.from(`--test\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: ${type}\r\n\r\n`),jpg,Buffer.from('\r\n--test--\r\n')]));req.emit('end');
    const result=await response;assert.equal(result.status,200,type);assert.match(result.data.url,/\.jpg$/);
  }
});
test('raster validation remains required; SVG and disguised text are rejected',()=>{
  const upload=backend();assert.equal(upload.detectedImageType(jpg),'image/jpeg');
  assert.equal(upload.imageDimensions(jpg,'image/jpeg').width,1);
  assert.equal(upload.detectedImageType(Buffer.from('<svg onload="alert(1)"></svg>')),'');
});
test('oversize request returns one explicit 413 instead of resetting the connection',()=>{
  const req=new EventEmitter();req.headers={};let count=0;
  backend().handleUpload(req,{},(_,status,data)=>{count++;assert.equal(status,413);assert.match(data.error,/5MB/);});
  req.emit('data',Buffer.alloc(6*1024*1024));req.emit('data',Buffer.alloc(10));req.emit('end');assert.equal(count,1);
});
function frontend(fetch){
  const html=fs.readFileSync(path.join(__dirname,'../public/admin/index.html'),'utf8');
  const source=html.slice(html.indexOf('async function uploadAdminImage('),html.indexOf('\nfunction delNote('));
  const ctx={fetch,API:'',token:'test',FormData:class{append(){}}};vm.runInNewContext(source,ctx);return ctx.uploadAdminImage;
}
test('frontend exposes server errors and rejects missing URL instead of silently losing images',async()=>{
  const file={name:'photo.jpg',size:100,type:'image/jpeg'};
  await assert.rejects(frontend(async()=>({ok:false,status:415,json:async()=>({error:'图片结构无效'})}))(file),/图片结构无效/);
  await assert.rejects(frontend(async()=>({ok:false,status:413,json:async()=>{throw Error();}}))(file),/大小限制/);
  await assert.rejects(frontend(async()=>({ok:true,json:async()=>({})}))(file),/未返回图片地址/);
  assert.equal(await frontend(async()=>({ok:true,json:async()=>({url:'/uploads/photo.jpg'})}))(file),'/uploads/photo.jpg');
});
