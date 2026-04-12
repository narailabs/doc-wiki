class User < ApplicationRecord
  has_many :orders
  has_many :roles, through: :user_roles
  belongs_to :organization

  validates :username, presence: true, uniqueness: true
  validates :email, presence: true
end
