import { createSignal, For, Show } from 'solid-js';
import { useDialog } from './DialogContext';
import {
  IconCode,
  IconBoxesStacked,
  IconChartColumn,
  IconUpload,
  IconXmark,
} from '../icons';
import styles from './ServerUploadModal.module.css';

export interface ServerUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (files: File[], category: string, path: string) => Promise<void>;
}

export default function ServerUploadModal(props: ServerUploadModalProps) {
  const dialog = useDialog();
  const [selectedCategory, setSelectedCategory] = createSignal<'scripts' | 'files' | 'reports'>('scripts');
  const [uploadPath, setUploadPath] = createSignal('');
  const [uploadFiles, setUploadFiles] = createSignal<File[]>([]);
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [isUploading, setIsUploading] = createSignal(false);

  let fileInputRef: HTMLInputElement | undefined;

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer?.files || []);
    setUploadFiles(prev => [...prev, ...files]);
  };

  const handleFileSelect = (e: Event) => {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      const files = Array.from(target.files);
      setUploadFiles(prev => [...prev, ...files]);
    }
  };

  const openFileDialog = () => {
    fileInputRef?.click();
  };

  const removeFile = (index: number) => {
    setUploadFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (uploadFiles().length === 0) return;

    setIsUploading(true);
    try {
      await props.onUpload(uploadFiles(), selectedCategory(), uploadPath());
      setUploadFiles([]);
      setUploadPath('');
      props.onClose();
    } catch (error) {
      console.error('上传失败:', error);
      await dialog.alert('上传失败: ' + (error as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    setUploadFiles([]);
    setUploadPath('');
    props.onClose();
  };

  const getCategoryDescription = (category: string) => {
    switch (category) {
      case 'scripts': return '存放脚本文件（.lua 等）';
      case 'files': return '存放通用文件';
      case 'reports': return '存放报告文件';
      default: return '';
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class={styles.overlay} onClick={handleClose}>
        <div class={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div class={styles.header}>
            <h3>上传文件到服务器</h3>
            <button class={styles.closeButton} onClick={handleClose}>
              <IconXmark size={18} />
            </button>
          </div>
          
          <div class={styles.body}>
            {/* 目标目录选择 */}
            <div class={styles.formGroup}>
              <label class={styles.label}>目标目录</label>
              <div class={styles.categorySelector}>
                <button 
                  class={`${styles.categoryBtn} ${selectedCategory() === 'scripts' ? styles.active : ''}`}
                  onClick={() => setSelectedCategory('scripts')}
                >
                  <IconCode size={16} />
                  <span>脚本目录</span>
                </button>
                <button 
                  class={`${styles.categoryBtn} ${selectedCategory() === 'files' ? styles.active : ''}`}
                  onClick={() => setSelectedCategory('files')}
                >
                  <IconBoxesStacked size={16} />
                  <span>资源目录</span>
                </button>
                <button 
                  class={`${styles.categoryBtn} ${selectedCategory() === 'reports' ? styles.active : ''}`}
                  onClick={() => setSelectedCategory('reports')}
                >
                  <IconChartColumn size={16} />
                  <span>报告目录</span>
                </button>
              </div>
              <div class={styles.categoryDescription}>
                {getCategoryDescription(selectedCategory())}
              </div>
            </div>
            
            {/* 子路径输入 */}
            <div class={styles.formGroup}>
              <label class={styles.label}>子目录（可选）</label>
              <input
                type="text"
                placeholder="例如: subfolder/another"
                value={uploadPath()}
                onInput={(e) => setUploadPath(e.currentTarget.value)}
                class={styles.input}
              />
            </div>
            
            {/* 拖拽上传区域 */}
            <div 
              class={`${styles.dropZone} ${isDragOver() ? styles.dragOver : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={openFileDialog}
            >
              <div class={styles.dropIcon}>
                <IconUpload size={32} />
              </div>
              <div class={styles.dropText}>拖拽文件到此处或点击选择</div>
              <input
                ref={(el) => fileInputRef = el}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
            </div>
            
            {/* 已选择文件列表 */}
            <Show when={uploadFiles().length > 0}>
              <div class={styles.fileList}>
                <div class={styles.fileListHeader}>
                  已选择 {uploadFiles().length} 个文件
                </div>
                <For each={uploadFiles()}>
                  {(file, index) => (
                    <div class={styles.fileItem}>
                      <span class={styles.fileName}>{file.name}</span>
                      <span class={styles.fileSize}>
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                      <button 
                        class={styles.removeBtn}
                        onClick={() => removeFile(index())}
                      >
                        <IconXmark size={14} />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
          
          <div class={styles.footer}>
            <button class={styles.cancelBtn} onClick={handleClose}>
              取消
            </button>
            <button 
              class={styles.uploadBtn}
              onClick={handleUpload}
              disabled={uploadFiles().length === 0 || isUploading()}
            >
              {isUploading() ? '上传中...' : `上传 ${uploadFiles().length} 个文件`}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
