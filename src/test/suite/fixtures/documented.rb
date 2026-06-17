# Represents a blog post
class Post
  # @param title [String] the post title
  # @param body [String] the post body
  def initialize(title, body)
    @title = title
    @body = body
  end

  # Returns the post summary
  # @return [String] first 50 characters of the body
  def summary
    @body[0, 50]
  end
end
