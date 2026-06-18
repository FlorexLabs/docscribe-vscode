class User
  def initialize(name, email)
    @name = name
    @email = email
  end

  def full_name
    "#{@name} Doe"
  end

  def contact_info
    "#{@email} (#{@name})"
  end
end
