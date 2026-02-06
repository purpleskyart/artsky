import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getArtboards,
  createArtboard,
  deleteArtboard,
  updateArtboardName,
  type Artboard,
} from '../lib/artboards'
import Layout from '../components/Layout'
import styles from './ArtboardsPage.module.css'

export default function ArtboardsPage() {
  const [boards, setBoards] = useState<Artboard[]>(() => getArtboards())
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  function refresh() {
    setBoards(getArtboards())
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim() || 'Untitled'
    createArtboard(name)
    setNewName('')
    refresh()
  }

  function handleDelete(id: string) {
    if (confirm('Delete this artboard?')) {
      deleteArtboard(id)
      refresh()
    }
  }

  function startEdit(board: Artboard) {
    setEditingId(board.id)
    setEditName(board.name)
  }

  function saveEdit() {
    if (editingId) {
      updateArtboardName(editingId, editName)
      refresh()
      setEditingId(null)
    }
  }

  return (
    <Layout title="Artboards" showNav>
      <div className={styles.wrap}>
        <form onSubmit={handleCreate} className={styles.createForm}>
          <input
            type="text"
            placeholder="New artboard name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={styles.input}
          />
          <button type="submit" className={styles.createBtn}>Create</button>
        </form>
        {boards.length === 0 ? (
          <p className={styles.empty}>
            No artboards yet. Open a post from the feed and use “Add to artboard” to save it here.
          </p>
        ) : (
          <div className={styles.bento}>
            {boards.map((board) => (
              <div key={board.id} className={styles.bentoCard}>
                <Link to={`/artboard/${board.id}`} className={styles.bentoLink}>
                  {board.posts.length > 0 ? (
                    <div className={styles.bentoThumbs}>
                      {board.posts.slice(0, 4).map((p) => (
                        <div key={p.uri} className={styles.bentoThumb}>
                          {p.thumb ? (
                            <img src={p.thumb} alt="" />
                          ) : (
                            <span className={styles.thumbPlaceholder}>📌</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.bentoEmpty}>No posts yet</div>
                  )}
                  <div className={styles.bentoInfo}>
                    <span className={styles.bentoName}>{board.name}</span>
                    <span className={styles.bentoCount}>{board.posts.length} post{board.posts.length !== 1 ? 's' : ''}</span>
                  </div>
                </Link>
                <div className={styles.bentoActions}>
                  {editingId === board.id ? (
                    <>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className={styles.editInput}
                        autoFocus
                        onBlur={saveEdit}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), saveEdit())}
                        onClick={(e) => e.preventDefault()}
                      />
                      <button type="button" className={styles.smallBtn} onClick={(e) => { e.preventDefault(); saveEdit(); }}>Save</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={styles.smallBtn} onClick={(e) => { e.preventDefault(); startEdit(board); }}>Rename</button>
                      <button type="button" className={styles.smallBtnDanger} onClick={(e) => { e.preventDefault(); handleDelete(board.id); }}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
