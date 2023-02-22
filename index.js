const express = require('express')
const { createHandler } = require('graphql-http/lib/use/express')
const { buildSchema } = require('graphql')
var cors = require('cors')

const users = require('./data/users')
const posts = require('./data/posts')
const comments = require('./data/comments')

// Construct a schema, using GraphQL schema language
const schema = buildSchema(`
  type Query {
    users: [User!]!
    user(id: ID!): User
    posts: [Post!]!
    post(id: ID!): Post
    comments(postId: ID!): [Comment!]!
    "Schema version"
    version: String
  }

  type Mutation {
    addComment(comment: CommentInput!): Comment
    addPost(post: PostInput!): Post
  }

  """ 
  User can be the author of a post or comment
  """
  type User {
    id: ID!
    name: String!
    email: String!

    "Support avatar size selection"
    avatar(size: AvatarSizes = S_128): String
  }

  type Post implements TextWithCreatedAt {
    id: ID!
    title: String!
    text: String!
    author: User
    image: String
    createdAt: DateTime!
    comments: [Comment]!
  }

  type Comment implements TextWithCreatedAt {
    id: ID!
    author: User
    post: Post!
    text: String!
    createdAt: DateTime!
  }

  interface TextWithCreatedAt {
    text: String!
    createdAt: DateTime!
  }

  input CommentInput {
    authorId: ID!
    postId: ID!
    text: String!
  }

  input PostInput {
    authorId: ID!
    title: String!
    text: String!
    image: String
  }

  enum AvatarSizes {
    S_32 @deprecated(reason: "Too small. Use S_64 instead")
    S_64
    S_128
    S_512
  }

  scalar DateTime
`)

const app = express()

const expressWs = require('express-ws')(app);

// The root provides a resolver function for each API endpoint
const root = {
  user({id}) {
    const user = users.find(u => u.id == id)
    if (user) {
      user['avatar'] = ({size}) => 'https://picsum.photos/'+size.substr(2)
    }

    return user
  },
  users: () => users.map(user => {
    user['avatar'] = ({size}) => 'https://picsum.photos/'+size.substr(2)

    return user
  }),

  version: () => '1.2.3',

  post({id}) {
    const post = posts.find(post => post.id == id)
    if (post) {
      post['image'] = 'https://picsum.photos/600/400'
      post['author'] = () => root.user({id: post.authorId})
      post['comments'] = () => root.comments({postId: id})
    }

    return post
  },
  posts: () => posts.map(post => {
    post['image'] = post.image || 'https://picsum.photos/600/400'
    post['author'] = () => root.user({id: post.authorId})
    post['comments'] = () => root.comments({postId: post.id})

    return post
  }),

  comments({postId}) {
    return comments.filter(c => c.postId == postId).map(comment => {
      const post = root.post({id: postId})
      comment['post'] = () => post
      comment['author'] = () => root.user({id: post.authorId})

      return comment
    })
  },

  addComment({ comment }) {
    const newComment = {
      "id": comments.length + 1,
      "text": comment.text,
      "authorId": comment.authorId,
      "createdAt": (new Date()).toString(),
      "postId": comment.postId
    }

    comments.push(newComment)

    return root.comments({postId: comment.postId}).find(c => c.id == newComment.id)
  },
  addPost({ post }) {
    const newPost = {
      "id": posts.length + 1,
      "title": post.title,
      "text": post.text,
      "authorId": post.authorId,
      "image": post.image,
      "createdAt": (new Date()).toString()
    }

    posts.push(newPost)

    broadcast(makeEvent('addPost', { newPost } ))

    return root.post({id: newPost.id})
  }
}

app.use(cors())

app.use('/graphql', createHandler({
  schema: schema,
  rootValue: root
}))

app.get('/ui', (req, res) => {
  res.sendFile(__dirname + '/ui.html')
})

app.ws('/ws', function(ws, req) {
  ws.on('message', function(msg) {
    const data = JSON.parse(msg)
    
    if (data.event === 'getPosts') {
      ws.send(makeEvent('updatePosts', { posts }))
    }

  });
});

const port = 4000

app.listen(port)

console.log(`Server started at ${port} port. Open http://localhost:${port}/ui`)


function broadcast(message) {
  expressWs.getWss().clients.forEach(c => c.send(message))
}

function makeEvent(eventName, data = {}) {
  return JSON.stringify({ event: eventName, data })
}