import { useEffect } from 'react';
import FileNode from './FileNode.tsx';
import { rootNodes, isLoading, loadRootDirectory } from '$lib/stores/explorer';
import { activeProject } from '$lib/stores/workspace';
import { useStore } from '$lib/react/useStore';
import './FileTree.css';

export default function FileTree() {
  const project = useStore(activeProject);
  const loading = useStore(isLoading);
  const nodes = useStore(rootNodes);

  // Load root directory whenever activeProject changes (the original reactive pattern).
  useEffect(() => {
    if (project) {
      loadRootDirectory(project.root_path);
    }
  }, [project]);

  return (
    <div className="file-tree" role="tree">
      {loading ? (
        <div className="tree-loading">
          <span className="loading-spinner"></span>
          <span>Loading files...</span>
        </div>
      ) : nodes.length > 0 ? (
        nodes.map((node) => <FileNode key={node.entry.path} node={node} />)
      ) : (
        <div className="tree-empty">
          <p>No files found</p>
        </div>
      )}
    </div>
  );
}
