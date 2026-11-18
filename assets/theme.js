(function(){var t=localStorage.getItem('al-theme');if(t)document.documentElement.dataset.theme=t;})();
window.toggleTheme=function(){var d=document.documentElement,n=d.dataset.theme==='light'?'dark':'light';d.dataset.theme=n;localStorage.setItem('al-theme',n);};
