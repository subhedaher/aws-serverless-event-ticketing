// Builds the top navigation bar on every page.
function renderNav() {
  const nav = document.getElementById("nav");
  if (!nav) return;
  nav.innerHTML = "";

  const brand = document.createElement("a");
  brand.href = "index.html";
  brand.className = "brand";
  brand.textContent = "فعالياتي";
  nav.appendChild(brand);

  const links = document.createElement("div");
  links.className = "links";

  const addLink = (text, href) => {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    links.appendChild(a);
  };

  addLink("الفعاليات", "index.html");

  const user = Auth.getUser();
  if (user) {
    addLink("تذاكري", "tickets.html");
    if (Auth.isAdmin()) {
      addLink("لوحة المشرف", "admin.html");
      addLink("الحضور", "checkin.html");
    }

    const name = document.createElement("span");
    name.className = "user-name";
    name.textContent = user.name;
    links.appendChild(name);

    const logout = document.createElement("button");
    logout.className = "btn btn-light";
    logout.textContent = "خروج";
    logout.onclick = () => {
      Auth.logout();
      location.href = "index.html";
    };
    links.appendChild(logout);
  } else {
    addLink("تسجيل الدخول", "login.html");
  }

  nav.appendChild(links);
}

document.addEventListener("DOMContentLoaded", renderNav);
