import os

images_dir = "images/posts_images"

os.makedirs(images_dir,exist_ok=True)

for file in os.listdir("posts"):
    if file.endswith(".md"):
        name = os.path.splitext(file)[0]
        folder = os.path.join(images_dir,name)

        os.makedirs(folder,exist_ok=True)

        print("create:",folder)