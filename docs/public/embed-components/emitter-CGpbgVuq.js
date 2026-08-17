function t(){const t=/* @__PURE__ */new Set;let e=!1;return{notify(){if(!e){e=!0;try{for(const e of t)e()}finally{e=!1}}},subscribe:e=>(t.add(e),()=>{t.delete(e)})}}export{t};
