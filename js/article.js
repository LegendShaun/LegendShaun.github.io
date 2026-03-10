const params = new URLSearchParams(window.location.search);
const file = params.get("file");

// 取得文件名（去掉 .md）
const title = file.replace(".md", "");

// 修改网页标题
document.title = title;


// 读取 markdown
fetch("posts/" + file)
.then(response => response.text())
.then(md => {
    
    document.getElementById("content").innerHTML = marked.parse(md);

});