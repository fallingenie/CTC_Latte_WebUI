const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./public-app-CH0Xt86X.js","./preload-helper-PPVm8Dsz.js","./public-app-B9p2odet.css"])))=>i.map(i=>d[i]);
import{_ as y}from"./preload-helper-PPVm8Dsz.js";(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))c(e);new MutationObserver(e=>{for(const a of e)if(a.type==="childList")for(const o of a.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&c(o)}).observe(document,{childList:!0,subtree:!0});function s(e){const a={};return e.integrity&&(a.integrity=e.integrity),e.referrerPolicy&&(a.referrerPolicy=e.referrerPolicy),e.crossOrigin==="use-credentials"?a.credentials="include":e.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function c(e){if(e.ep)return;e.ep=!0;const a=s(e);fetch(e.href,a)}})();const f="ctc:beta-access",h="7512f5336bf298156b486c61d5d62910ece816346cb3760691a39aa919277e5c",d="granted-v1";async function b(r,t=globalThis.crypto){if(!t?.subtle||typeof TextEncoder>"u")throw new Error("secure-crypto-unavailable");const s=new TextEncoder().encode(String(r)),c=await t.subtle.digest("SHA-256",s);return[...new Uint8Array(c)].map(e=>e.toString(16).padStart(2,"0")).join("")}function S(r,t){const s=typeof r=="string"?r:"",c=t,e=Math.max(s.length,c.length);let a=s.length^c.length;for(let o=0;o<e;o+=1)a|=(s.charCodeAt(o)||0)^(c.charCodeAt(o)||0);return a===0}async function v(r,t=globalThis.crypto){if(typeof r!="string"||r.length===0)return!1;const s=await b(r,t);return S(s,h)}function w(r){const t=g();if(!t)return!1;try{return t.getItem(f)===d}catch{return!1}}function A(r){const t=g();if(!t)return!1;try{return t.setItem(f,d),!0}catch{return!1}}function g(r){try{return globalThis.sessionStorage}catch{return null}}const i=document.getElementById("root");let l=null;if(!i)throw new Error("접근 화면을 표시할 영역이 없습니다.");w()?await p():m();async function p(){if(l)return l;document.body.classList.remove("access-gate-active"),i.replaceChildren(),l=y(()=>import("./public-app-CH0Xt86X.js").then(r=>r.p),__vite__mapDeps([0,1,2]),import.meta.url);try{return await l,!0}catch(r){return l=null,m("화면을 불러오지 못했습니다. 새로고침 후 다시 시도하세요."),console.error(r),!1}}function m(r=""){document.body.classList.add("access-gate-active"),i.innerHTML=`
    <main class="access-gate-shell">
      <section class="access-gate-panel" aria-labelledby="access-gate-title">
        <div class="access-gate-brand">
          <img src="./favicon.svg" alt="" width="56" height="56" />
          <div>
            <p class="access-gate-eyebrow">출시 후보 시험 운영</p>
            <h1 id="access-gate-title">기후 타임캡슐</h1>
          </div>
        </div>
        <p class="access-gate-copy">시험 참여자용 화면입니다.</p>
        <form class="access-gate-form" novalidate>
          <label for="access-password">접속 암호</label>
          <input
            id="access-password"
            name="password"
            type="password"
            autocomplete="current-password"
            aria-describedby="access-gate-status"
            required
          />
          <p id="access-gate-status" class="access-gate-status" aria-live="polite"></p>
          <button type="submit">입장</button>
        </form>
      </section>
    </main>
  `;const t=i.querySelector(".access-gate-form"),s=i.querySelector("#access-password"),c=t?.querySelector("button[type='submit']"),e=i.querySelector("#access-gate-status");r&&e&&n(e,r,!0),s?.focus(),t?.addEventListener("submit",async a=>{if(a.preventDefault(),!(!s||!c||!e)){if(!s.value){n(e,"접속 암호를 입력하세요.",!0),s.focus();return}u(t,c,!0),n(e,"암호를 확인하고 있습니다.");try{const o=await v(s.value);if(s.value="",!o){n(e,"암호가 올바르지 않습니다. 대소문자와 특수문자를 확인하세요.",!0),u(t,c,!1),s.focus();return}A(),n(e,"확인되었습니다. 화면을 준비하고 있습니다."),await p()}catch(o){if(o?.message==="secure-crypto-unavailable"){n(e,"이 브라우저에서는 암호를 안전하게 확인할 수 없습니다. 최신 브라우저로 다시 접속하세요.",!0),u(t,c,!1);return}n(e,"화면을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.",!0),u(t,c,!1)}}})}function u(r,t,s){r.setAttribute("aria-busy",String(s)),t.disabled=s,t.textContent=s?"확인 중":"입장"}function n(r,t,s=!1){r.textContent=t,r.classList.toggle("is-error",s),s?r.setAttribute("role","alert"):r.removeAttribute("role")}
