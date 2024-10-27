Import("env")
import os
import shutil
import time

def move_firmware_files(source, target, env):
    print("Program has been built! Moving firmware files...")

    src_dir = "build"  # Папка с собранными бинарниками
    dest_dir = "bin"   # Папка для перемещения бинарников

    # Создаем директорию назначения, если она не существует
    os.makedirs(dest_dir, exist_ok=True)

    # Проверяем наличие файла firmware.bin и ждем, пока он не появится
    firmware_file_found = False
    while not firmware_file_found:
        # Проверяем, существует ли firmware.bin
        for root, dirs, files in os.walk(src_dir):
            if "firmware.bin" in files:
                firmware_file_found = True
                break
        if not firmware_file_found:
            print("Waiting for firmware.bin to be created...")
            time.sleep(1)

    # Проходим по всем файлам и папкам в исходной директории
    for root, dirs, files in os.walk(src_dir):
        for file in files:
            if file == "firmware.bin":
                # Полный путь к текущему файлу
                src_file = os.path.join(root, file)
                # Определяем целевую директорию
                relative_path = os.path.relpath(root, src_dir)
                dest_folder = os.path.join(dest_dir, relative_path)

                # Создаем целевую директорию, если она не существует
                os.makedirs(dest_folder, exist_ok=True)

                # Полный путь к целевому файлу
                dest_file = os.path.join(dest_folder, file)

                # Перемещаем файл
                shutil.copy(src_file, dest_file)
                print(f"Moved: {src_file} -> {dest_file}")

# Добавляем пост-действие после сборки
env.AddPostAction("$BUILD_DIR/firmware.bin", move_firmware_files)
