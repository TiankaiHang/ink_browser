import test from "node:test";
import assert from "node:assert/strict";
import { attachPdfZoom, wheelScale, anchoredScroll, MIN_SCALE, MAX_SCALE } from "../src/zoom.js";

function dispatch(target, type, properties) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
  return event;
}
test("Ctrl-wheel, Cmd-wheel, and pinch use PDF zoom; ordinary scrolling is untouched", () => {
  const target = new EventTarget();
  let enabled = true;
  let scale = 1;
  let point;
  const remove = attachPdfZoom(target, { isEnabled:()=>enabled, getScale:()=>scale, onZoom:(next, anchor)=>{scale=next;point=anchor;}, onFit:()=>{scale=1;} });
  const ordinary = dispatch(target,"wheel",{deltaY:-100});
  assert.equal(ordinary.defaultPrevented,false);
  assert.equal(scale,1);
  const ctrl = dispatch(target,"wheel",{ctrlKey:true,deltaY:-100,deltaMode:0,clientX:345,clientY:456});
  assert.equal(ctrl.defaultPrevented,true);
  assert.ok(scale>1);
  assert.deepEqual(point,{clientX:345,clientY:456});
  dispatch(target,"wheel",{metaKey:true,deltaY:100,deltaMode:0});
  assert.ok(Math.abs(scale-1)<1e-10);
  dispatch(target,"wheel",{ctrlKey:true,deltaY:-1,deltaMode:0});
  assert.ok(scale>1 && scale<1.01,"trackpad pinch stays gradual");
  enabled=false;
  const disabled=dispatch(target,"wheel",{ctrlKey:true,deltaY:-100});
  assert.equal(disabled.defaultPrevented,false);
  remove();
  enabled=true;
  assert.equal(dispatch(target,"wheel",{ctrlKey:true,deltaY:-100}).defaultPrevented,false);
});
test("zoom keyboard shortcuts are handled within the PDF viewer", () => {
  const target=new EventTarget();
  let scale=1;
  let fits=0;
  attachPdfZoom(target,{isEnabled:()=>true,getScale:()=>scale,onZoom:next=>{scale=next;},onFit:()=>{scale=1;fits++;}});
  assert.equal(dispatch(target,"keydown",{ctrlKey:true,key:"="}).defaultPrevented,true);
  assert.equal(scale,1.2);
  dispatch(target,"keydown",{metaKey:true,key:"-"});
  assert.ok(Math.abs(scale-1)<1e-10);
  dispatch(target,"keydown",{metaKey:true,key:"0"});
  assert.equal(fits,1);
  assert.equal(dispatch(target,"keydown",{ctrlKey:true,key:"c"}).defaultPrevented,false);
});
test("wheel units and scale limits handle mouse wheels and touchpads",()=>{
  assert.equal(wheelScale(1,{deltaY:-3,deltaMode:1}),wheelScale(1,{deltaY:-48,deltaMode:0}));
  assert.equal(wheelScale(MAX_SCALE,{deltaY:-100,deltaMode:0}),MAX_SCALE);
  assert.equal(wheelScale(MIN_SCALE,{deltaY:100,deltaMode:0}),MIN_SCALE);
});
test("scroll compensation keeps the chosen PDF point under the mouse",()=>{
  const scroll={x:100,y:900};
  const rect={left:20,top:-200,width:1600,height:2200};
  const anchor={x:.4,y:.3,clientX:420,clientY:360};
  const next=anchoredScroll(rect,anchor,scroll);
  assert.equal(rect.left+scroll.x-next.left+rect.width*anchor.x,anchor.clientX);
  assert.equal(rect.top+scroll.y-next.top+rect.height*anchor.y,anchor.clientY);
});
