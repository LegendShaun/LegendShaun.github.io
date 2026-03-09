import os,json

posts = []
for file in os.listdir("posts"):
    if file.endswith(".md"):
        posts.append({
            "title":file.replace(".md",""),
            "file":file
        })
with open("js/posts.json","w") as f:
    json.dump(posts,f,indent=2,ensure_ascii=False)