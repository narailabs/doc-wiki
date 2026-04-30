using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Collections.Generic;

namespace Example.Models
{
    [Table("users")]
    public class User
    {
        [Key]
        public int Id { get; set; }

        [Required]
        [MaxLength(150)]
        [Column("username")]
        public string Username { get; set; }

        [Column("email")]
        public string Email { get; set; }

        public ICollection<Order> Orders { get; set; }
    }
}
