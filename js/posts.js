fetch("./js/posts.json")
.then(response => response.json())
.then(posts => {

    const list = document.getElementById("post-list");

    posts.forEach(post => {

        const li = document.createElement("li");

        const link = document.createElement("a");

        link.href = "article.html?file=" + post.file;
        link.textContent = post.title;

        li.appendChild(link);
        list.appendChild(li);

    });

});